require('isomorphic-fetch')
const Koa = require('koa')
const next = require('next')
const { default: createShopifyAuth } = require('@shopify/koa-shopify-auth')
const dotenv = require('dotenv')
const { verifyRequest } = require('@shopify/koa-shopify-auth')
const session = require('koa-session')

dotenv.config()
const { default: graphQLProxy } = require('@shopify/koa-shopify-graphql-proxy')
const Router = require('koa-router')
const { receiveWebhook, registerWebhook } = require('@shopify/koa-shopify-webhooks')

const { ApiVersion } = require('@shopify/koa-shopify-graphql-proxy')
const createSubscription = require('./server/createSubscription')
const createUsagePlan = require('./server/createUsagePlan')

const port = parseInt(process.env.PORT, 10) || 3000
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

const { SHOPIFY_API_SECRET_KEY, SHOPIFY_API_KEY, HOST } = process.env

app.prepare().then(() => {
  const server = new Koa()
  const router = new Router()
  server.use(session({ sameSite: 'none', secure: true }, server))
  server.keys = [SHOPIFY_API_SECRET_KEY]

  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET_KEY,
      scopes: [ 'read_products', 'write_products' ],
      async afterAuth(ctx) {
        // eslint-disable-next-line no-unused-vars
        const urlParams = new URLSearchParams(ctx.request.url)
        const { shop, accessToken } = ctx.state.shopify
        // ctx.session.save(shop)
        ctx.cookies.set('shopOrigin', shop, {
          httpOnly: false,
          secure  : true,
          sameSite: 'none'
        })
      //   ctx.cookies.set('shopOrigin', shop, {
      //     httpOnly : true,
      //     secure   : true,
      //     signed   : true,
      //     overwrite: true,
      //     sameSite : 'none',
      // })
      const registration = await registerWebhook({
        address   : `${HOST}/webhooks/products/create`,
        topic     : 'PRODUCTS_CREATE',
        accessToken,
        shop,
        apiVersion: ApiVersion.October19
      })
   
      if (registration.success) {
        console.log('Successfully registered webhook!')
      } else {
        console.log('Failed to register webhook', registration.result)
      }
        ctx.redirect(`/?shop=${shop}`)
        const returnUrl = `${HOST}?shop=${shop}`
        const { subscriptionUrl, appSubscriptionCreateLineItemId } = await createSubscription(accessToken, shop, returnUrl)
        console.log('appSubscriptionCreateLineItemId', appSubscriptionCreateLineItemId)
        // const appUsageId = await createUsagePlan(accessToken, shop, appSubscriptionCreateLineItemId)
        ctx.redirect(subscriptionUrl)
      },
    })
  )

  const webhook = receiveWebhook({ secret: SHOPIFY_API_SECRET_KEY })

// TIP from shopify - In a production app, you would need to store the webhook in a database to access the response on the frontend. 
 router.post('/webhooks/products/create', webhook, (ctx) => {
   console.log('received webhook: ', ctx.state.webhook)
 })

  server.use(graphQLProxy({ version: ApiVersion.October19 }))
  router.get('(.*)', verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res)
    ctx.respond = false
    ctx.res.statusCode = 200
   })
   server.use(router.allowedMethods())
   server.use(router.routes())

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`> Ready on http://localhost:${port}`)
  })
})