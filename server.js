const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4001;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    console.log('📁 File upload attempt:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      console.log('✅ File type accepted');
      return cb(null, true);
    } else {
      console.log('❌ File type rejected:', { extname, mimetype });
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Middleware
app.use(cors({
  origin: 'https://localhost:3001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://localhost:3001');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Serve uploaded images with CORS headers
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://localhost:3001');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static(uploadsDir));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Backend server is running',
    port: PORT,
    protocol: 'HTTPS'
  });
});

// File-based product storage for persistence
const productsFile = path.join(__dirname, 'products.json');

// Load products from file
let products = [];
function loadProducts() {
  try {
    if (fs.existsSync(productsFile)) {
      const data = fs.readFileSync(productsFile, 'utf8');
      products = JSON.parse(data);
      console.log(`📦 Loaded ${products.length} products from file`);
    } else {
      products = [];
      console.log('📦 No products file found, starting with empty array');
    }
  } catch (error) {
    console.error('❌ Error loading products:', error);
    products = [];
  }
}

// Save products to file
function saveProducts() {
  try {
    fs.writeFileSync(productsFile, JSON.stringify(products, null, 2), 'utf8');
    console.log(`💾 Saved ${products.length} products to file`);
  } catch (error) {
    console.error('❌ Error saving products:', error);
  }
}

// Load products on startup
loadProducts();

// API Routes
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend HTTPS server is working!' });
});

// Get all products
app.get('/api/products', (req, res) => {
  console.log('📦 GET /api/products - Returning', products.length, 'products');
  res.json(products);
});

// Get single product
app.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

// Update product
app.put('/api/products/:id', upload.single('image'), (req, res, next) => {
  console.log('📥 PUT /api/products/:id - Request received');
  console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📥 Content-Type:', req.headers['content-type']);
  
  const productId = parseInt(req.params.id);
  const productIndex = products.findIndex(p => p.id === productId);
  
  if (productIndex === -1) {
    console.error('❌ Product not found:', productId);
    return res.status(404).json({ error: 'Product not found' });
  }

  // Parse FormData fields - multer handles file uploads, but text fields are in req.body
  const name = req.body.name;
  const price = req.body.price;
  const removeImage = req.body.removeImage;
  const category = req.body.category; // This should be a string from FormData
  const toppings = req.body.toppings;
  const ingredients = req.body.ingredients;
  
  console.log('📦 Raw req.body:', req.body);
  console.log('📦 Parsed category:', category, 'Type:', typeof category);
  const product = products[productIndex];
  
  console.log('📝 Updating product:', productId);
  console.log('📝 Request body:', { name, price, removeImage, category });
  console.log('📝 Category value:', category, 'Type:', typeof category, 'Is undefined:', category === undefined, 'Is empty string:', category === '');
  console.log('📝 Current product category:', product.category);
  console.log('📝 File uploaded:', req.file ? {
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path
  } : 'No file');
  
  // Log if image field exists but file wasn't parsed
  if (req.body.image && !req.file) {
    console.warn('⚠️ Image field in body but no file parsed. This might indicate a FormData issue.');
  }
  
  try {

  // Update product fields
  if (name) product.name = name;
  if (price) product.price = parseFloat(price);
  // Update category if provided
  // FormData always sends strings, so check if category field exists in request
  if (category !== undefined && category !== null && category !== '') {
    // Category field was sent and is not empty - update it
    const oldCategory = product.category;
    product.category = category;
    console.log('✅ Updated category from "' + oldCategory + '" to "' + product.category + '"');
  } else if (category === '') {
    // Empty string means use default
    const oldCategory = product.category;
    product.category = 'Other';
    console.log('⚠️ Category was empty string, setting to default "Other" (was: "' + oldCategory + '")');
  } else {
    console.log('⚠️ Category field not in request body (undefined/null), keeping existing category:', product.category);
  }
  
  // Parse and update toppings if provided
  if (toppings !== undefined) {
    try {
      product.toppings = typeof toppings === 'string' ? JSON.parse(toppings) : toppings;
    } catch (e) {
      product.toppings = [];
    }
  }
  
  // Parse and update ingredients if provided
  if (ingredients !== undefined) {
    try {
      product.ingredients = typeof ingredients === 'string' ? JSON.parse(ingredients) : ingredients;
    } catch (e) {
      product.ingredients = [];
    }
  }

  // Handle image removal
  if (removeImage === 'true') {
    console.log('🗑️ Removing image from product');
    // Delete old image if it exists
    if (product.image && product.image.startsWith('/uploads/')) {
      const oldImagePath = path.join(__dirname, product.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
        console.log('✅ Deleted old image:', oldImagePath);
      }
    }
    product.image = null;
  }
  // Handle image upload
  else if (req.file) {
    console.log('📸 Uploading new image:', req.file.filename);
    // Delete old image if it exists
    if (product.image && product.image.startsWith('/uploads/')) {
      const oldImagePath = path.join(__dirname, product.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
        console.log('✅ Deleted old image:', oldImagePath);
      }
    }
    // Set new image path
    product.image = `/uploads/${req.file.filename}`;
    console.log('✅ Image path set to:', product.image);
  } else {
    console.log('ℹ️ No image file in request');
  }

    products[productIndex] = product;
    saveProducts(); // Persist to file
    
    // Verify the save worked by reading back
    const savedProducts = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
    const savedProduct = savedProducts.find(p => p.id === productId);
    console.log('✅ Product updated successfully:', {
      id: product.id,
      name: product.name,
      category: product.category,
      savedCategory: savedProduct?.category,
      image: product.image,
      imageUrl: product.image ? `https://localhost:4001${product.image}` : null
    });
    if (savedProduct?.category !== product.category) {
      console.error('❌ WARNING: Category mismatch! Product category:', product.category, 'but saved category:', savedProduct?.category);
    }
    console.log('📤 Sending response with product category:', product.category);
    res.json(product);
  } catch (error) {
    console.error('❌ Error updating product:', error);
    next(error); // Pass to error handler
  }
}, (error, req, res, next) => {
  // Error handler for this route
  console.error('❌ Upload route error handler:', error);
  console.error('❌ Error stack:', error.stack);
  if (error instanceof multer.MulterError) {
    console.error('❌ Multer error code:', error.code);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${error.message}`, code: error.code });
  }
  if (error.message === 'Only image files are allowed!') {
    return res.status(400).json({ error: error.message });
  }
  console.error('❌ Unknown error:', error);
  res.status(500).json({ error: error.message || 'Internal server error', details: error.toString() });
});

// Create product
app.post('/api/products', upload.single('image'), (req, res) => {
  const { name, price, description, category, toppings, ingredients } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  // Parse toppings and ingredients
  let parsedToppings = [];
  let parsedIngredients = [];
  
  try {
    parsedToppings = toppings ? (typeof toppings === 'string' ? JSON.parse(toppings) : toppings) : [];
  } catch (e) {
    parsedToppings = [];
  }
  
  try {
    parsedIngredients = ingredients ? (typeof ingredients === 'string' ? JSON.parse(ingredients) : ingredients) : [];
  } catch (e) {
    parsedIngredients = [];
  }

  const newProduct = {
    id: products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1,
    name,
    price: parseFloat(price),
    description: description || '',
    category: category || 'Other',
    image: req.file ? `/uploads/${req.file.filename}` : null,
    toppings: parsedToppings,
    ingredients: parsedIngredients
  };

  products.push(newProduct);
  saveProducts(); // Persist to file
  res.status(201).json(newProduct);
});

// Global error handler for multer and other errors
app.use((error, req, res, next) => {
  console.error('❌ Global error handler:', error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${error.message}` });
  }
  if (error) {
    return res.status(400).json({ error: error.message || 'Upload failed' });
  }
  next();
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);
  const productIndex = products.findIndex(p => p.id === productId);
  
  if (productIndex === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = products[productIndex];
  
  // Delete associated image if it exists
  if (product.image && product.image.startsWith('/uploads/')) {
    const imagePath = path.join(__dirname, product.image);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }

  products.splice(productIndex, 1);
  saveProducts(); // Persist to file
  res.json({ message: 'Product deleted successfully' });
});

// SSL Certificate paths
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, '../ssl/server.key')),
  cert: fs.readFileSync(path.join(__dirname, '../ssl/server.crt'))
};

// Create HTTPS server
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`🚀 Backend HTTPS server running on https://localhost:${PORT}`);
  console.log(`📝 Health check: https://localhost:${PORT}/api/health`);
});


