# Deployment Deprecated

Cloud deployment instructions (Vercel/Render) are deprecated and this repository is now configured for local development only.

Refer to `README.md` for details. Quick start:

```bash
# From project root
npm install
npm run dev   # starts server and client concurrently
```

Environment variables (examples):

Frontend (`client/.env` or `client/.env.development`):
```
VITE_API_URL=http://localhost:5000/api
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
```

Backend (`server/.env`):
```
NODE_ENV=development
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=90d
JWT_COOKIE_EXPIRES=90
```
