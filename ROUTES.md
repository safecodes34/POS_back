# Backend API Routes

Complete list of all routes in the backend server.

## Static Files & Pages

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/uploads/*` | Serve uploaded product images |
| GET | `/test-connection` | Test connection HTML page |
| GET | `/logs` | User activity logs web interface |
| GET | `/users` | User management web interface |

---

## Health & System

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Health check endpoint |
| GET | `/api/test` | Simple test endpoint |
| GET | `/.well-known/appspecific/com.chrome.devtools.json` | Chrome DevTools config |
| OPTIONS | `*` | CORS preflight handler |
| POST | `/api/admin/reload-users` | Reload users from file |

---

## Authentication Routes

| Method | Route | Description | Request Body |
|--------|-------|-------------|--------------|
| POST | `/api/auth/signup` | Create new user account | `{ email, password }` |
| POST | `/api/auth/login` | User login | `{ email, password }` |
| GET | `/api/auth/user` | Get user by email | Query: `email` |

---

## User Settings Routes

| Method | Route | Description | Request Body |
|--------|-------|-------------|--------------|
| GET | `/api/user/settings` | Get user settings | Query: `email` |
| POST | `/api/user/settings` | Save user settings | `{ email, settings }` |

---

## User Management Routes

| Method | Route | Description | Request Body / Params |
|--------|-------|-------------|----------------------|
| GET | `/api/users` | Get all users (filtered) | Query: `email?`, `limit?` |
| DELETE | `/api/users/:id` | Delete user account | Params: `id` |

---

## User Logs Routes

| Method | Route | Description | Query Parameters |
|--------|-------|-------------|------------------|
| GET | `/api/user-logs` | Get user activity logs | `email?`, `type?`, `limit?` |

---

## Product Routes

All product routes require `userEmail` for user-specific data isolation.

| Method | Route | Description | Request Body / Params |
|--------|-------|-------------|----------------------|
| GET | `/api/products` | Get all products for user | Query: `userEmail` (required) |
| GET | `/api/products/:id` | Get single product | Query: `userEmail` (required), Params: `id` |
| POST | `/api/products` | Create new product | FormData: `name`, `price`, `description?`, `category?`, `toppings?`, `ingredients?`, `image?`, `userEmail` |
| PUT | `/api/products/:id` | Update product | FormData: `name?`, `price?`, `category?`, `toppings?`, `ingredients?`, `image?`, `removeImage?`, `userEmail` |
| DELETE | `/api/products/:id` | Delete product | Query: `userEmail` (required), Params: `id` |

**Notes:**
- Image uploads use `multer` with 5MB limit
- Images are processed with AI detection/cropping
- Allowed image types: jpeg, jpg, png, gif, webp

---

## Transaction Routes

| Method | Route | Description | Request Body / Query |
|--------|-------|-------------|---------------------|
| GET | `/api/transactions` | Get all transactions for user | Query: `userEmail` (required) |
| POST | `/api/transactions` | Create new transaction | `{ customerName, tableNumber?, orderType?, paymentMethod, items[], subtotal, tax, total, timestamp?, userEmail, stripePaymentIntentId? }` |

**Transaction Item Structure:**
```json
{
  "name": "string",
  "quantity": "number",
  "price": "number",
  "totalPrice": "number (optional)",
  "selectedToppings": "array (optional)"
}
```

---

## Category Routes

All category routes require `userEmail` for user-specific data isolation.

| Method | Route | Description | Request Body / Query |
|--------|-------|-------------|---------------------|
| GET | `/api/categories` | Get categories for user | Query: `userEmail` (required) |
| POST | `/api/categories` | Save categories for user | `{ userEmail, categories[] }` |

---

## Team Members Routes

All team member routes require `userEmail` for user-specific data isolation.

| Method | Route | Description | Request Body / Query |
|--------|-------|-------------|---------------------|
| GET | `/api/team-members` | Get team members for user | Query: `userEmail` (required) |
| POST | `/api/team-members` | Save team members for user | `{ userEmail, teamMembers[] }` |

---

## Menu Analysis Routes

| Method | Route | Description | Request Body / Params |
|--------|-------|-------------|----------------------|
| POST | `/api/menu/analyze` | Upload and analyze menu file | FormData: `menu` (image/PDF, 10MB max) |
| GET | `/api/menu/status/:jobId` | Get menu analysis job status | Params: `jobId` |

**Menu Analysis:**
- Uses OpenAI Vision API (GPT-4o)
- Supports images (jpeg, jpg, png, gif, webp) and PDFs
- Returns structured menu data with sections, items, prices, toppings, and ingredients

---

## Stripe Terminal Routes

| Method | Route | Description | Request Body |
|--------|-------|-------------|--------------|
| POST | `/api/stripe-terminal/connection-token` | Create connection token for Stripe Terminal | None |
| POST | `/api/stripe-terminal/create-payment-intent` | Create payment intent for card reader | `{ amount, currency?, metadata? }` |
| POST | `/api/stripe-terminal/process-payment` | Process payment on reader | `{ payment_intent_id, reader_id }` |
| POST | `/api/stripe-terminal/capture-payment` | Capture payment intent | `{ payment_intent_id }` |
| GET | `/api/stripe-terminal/payment-intent/:id` | Get payment intent status | Params: `id` |
| POST | `/api/stripe-terminal/cancel-payment` | Cancel payment intent | `{ payment_intent_id }` |

---

## Subscription Routes

| Method | Route | Description | Request Body / Query |
|--------|-------|-------------|---------------------|
| GET | `/api/subscription/publishable-key` | Get Stripe publishable key | None |
| POST | `/api/subscription/create-subscription` | Create Stripe Checkout session | `{ email, discountCode? }` |
| POST | `/api/subscription/update-status` | Update user subscription status | `{ email, subscriptionStatus }` |
| GET | `/api/subscription/verify-session` | Verify Stripe checkout session | Query: `session_id` |

**Subscription Details:**
- Setup fee: $99.00 (one-time)
- Monthly subscription: $30.00/month
- Supports discount codes/promotion codes

---

## Security Notes

- All product, category, team member, and transaction routes are **user-specific** - they require `userEmail` parameter
- Passwords are hashed using SHA-256 before storage
- User authentication is email-based
- CORS is configured for specific allowed origins
- File uploads are limited (5MB for products, 10MB for menus)

---

## Data Storage

The backend uses file-based JSON storage:
- `users.json` - User accounts
- `userSettings.json` - User settings
- `products.json` - Products (user-specific)
- `categories.json` - Categories (user-specific)
- `teamMembers.json` - Team members (user-specific)
- `transactions.json` - Transactions (with userEmail filtering)
- `userLogs.json` - Activity logs

---

## Error Handling

- Multer errors (file upload): Returns 400 with error message
- Validation errors: Returns 400 with specific error message
- Not found errors: Returns 404
- Server errors: Returns 500 with error details (in development mode)
