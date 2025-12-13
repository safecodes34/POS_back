// Load environment variables FIRST before using them
require('dotenv').config();

const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const imageProcessor = require('./imageProcessor');

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

// Multer config for menu files (images and PDFs)
const menuStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'menu-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const menuUpload = multer({
  storage: menuStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for menu files
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'application/pdf';
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (PNG, JPG) or PDF files are allowed!'));
    }
  }
});

// CORS configuration - supports both localhost and production
const allowedOrigins = [
  'https://localhost:3001',
  process.env.FRONTEND_URL, // e.g., https://your-app.vercel.app
  'https://pos-front-one.vercel.app', // Production frontend
  'https://pos-front-topaz.vercel.app', // Current Vercel deployment
].filter(Boolean); // Remove undefined values

// Helper function to check if origin is a local network IP
const isLocalNetworkIP = (origin) => {
  if (!origin) return false;
  // Match IPv4 addresses in private ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  const ipPattern = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+):\d+$/;
  return ipPattern.test(origin);
};

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Log all CORS requests for debugging
    console.log('🔍 CORS Request - Origin:', origin || '(no origin)', '| NODE_ENV:', process.env.NODE_ENV || 'development');
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('✅ CORS: Allowing request with no origin');
      return callback(null, true);
    }
    
    // Normalize origin (remove trailing slash)
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    // Check if origin is in allowed list (exact match)
    if (allowedOrigins.indexOf(normalizedOrigin) !== -1 || allowedOrigins.indexOf(origin) !== -1) {
      console.log('✅ CORS: Allowing origin from allowed list:', origin);
      callback(null, true);
    } else if (origin && (origin.includes('vercel.app') || normalizedOrigin.includes('vercel.app'))) {
      // Allow all Vercel preview URLs (case-insensitive check)
      console.log('✅ CORS: Allowing Vercel origin:', origin);
      callback(null, true);
    } else {
      // In development, allow localhost variations and local network IPs
      if (process.env.NODE_ENV !== 'production') {
        const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
        const isNetworkIP = isLocalNetworkIP(origin);
        
        if (isLocalhost || isNetworkIP) {
          console.log('✅ CORS: Allowing development origin:', origin);
          console.log('   - Is localhost:', isLocalhost);
          console.log('   - Is network IP:', isNetworkIP);
          callback(null, true);
          return;
        }
      }
      console.log('❌ CORS blocked origin:', origin);
      console.log('   Allowed origins:', allowedOrigins);
      console.log('   Is local network IP?', isLocalNetworkIP(origin));
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? origin.replace(/\/$/, '') : null;
  if (allowedOrigins.includes(origin) || 
      allowedOrigins.includes(normalizedOrigin) || 
      (origin && origin.includes('vercel.app')) || 
      (normalizedOrigin && normalizedOrigin.includes('vercel.app')) || 
      (process.env.NODE_ENV !== 'production' && origin?.includes('localhost'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Content Security Policy middleware
app.use((req, res, next) => {
  // Set CSP header that allows:
  // - connect-src: localhost connections (for API calls and Chrome DevTools)
  // - script-src: unsafe-eval and unsafe-inline (for inline scripts in /logs page)
  // - default-src: self (for other resources)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' https://localhost:4001 https://localhost:3001; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    "object-src 'none';"
  );
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Serve uploaded images with CORS headers
app.use('/uploads', (req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? origin.replace(/\/$/, '') : null;
  if (allowedOrigins.includes(origin) || 
      allowedOrigins.includes(normalizedOrigin) || 
      (origin && origin.includes('vercel.app')) || 
      (normalizedOrigin && normalizedOrigin.includes('vercel.app')) || 
      (process.env.NODE_ENV !== 'production' && origin?.includes('localhost'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static(uploadsDir));

// Serve test connection page
app.get('/test-connection', (req, res) => {
  console.log('📄 Test connection page requested');
  const testPagePath = path.join(__dirname, 'test-connection.html');
  console.log('📄 Looking for file at:', testPagePath);
  console.log('📄 File exists:', fs.existsSync(testPagePath));
  
  if (fs.existsSync(testPagePath)) {
    res.sendFile(testPagePath, (err) => {
      if (err) {
        console.error('❌ Error sending test page:', err);
        res.status(500).send('Error loading test page: ' + err.message);
      } else {
        console.log('✅ Test page sent successfully');
      }
    });
  } else {
    console.error('❌ Test page file not found at:', testPagePath);
    res.status(404).send('Test page not found at: ' + testPagePath);
  }
});

// Serve static HTML page for user logs UI
app.get('/logs', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Logs - POS System</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%);
      color: white;
      padding: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header h1 {
      font-size: 2rem;
      font-weight: 600;
    }
    
    .controls {
      display: flex;
      gap: 1rem;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .filter-group label {
      font-size: 0.875rem;
      font-weight: 500;
      opacity: 0.9;
    }
    
    .filter-group input,
    .filter-group select {
      padding: 0.5rem 1rem;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 0.9rem;
    }
    
    .filter-group input::placeholder {
      color: rgba(255, 255, 255, 0.6);
    }
    
    .filter-group select {
      cursor: pointer;
      color: white !important;
    }
    
    .filter-group select option {
      background: #1e3a5f;
      color: white;
    }
    
    .btn {
      padding: 0.5rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-primary {
      background: white;
      color: #1e3a5f;
    }
    
    .btn-primary:hover {
      background: #f0f0f0;
      transform: translateY(-2px);
    }
    
    .btn-secondary {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    
    .stats {
      display: flex;
      gap: 1.5rem;
      padding: 1.5rem 2rem;
      background: #f8f9fa;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .stat-card {
      flex: 1;
      background: white;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .stat-label {
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 0.5rem;
    }
    
    .stat-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: #1e3a5f;
    }
    
    .content {
      padding: 2rem;
      max-height: calc(100vh - 300px);
      overflow-y: auto;
    }
    
    .log-entry {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: all 0.2s;
    }
    
    .log-entry:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      transform: translateX(4px);
    }
    
    .log-entry.signup {
      border-left-color: #48bb78;
    }
    
    .log-entry.settings {
      border-left-color: #4299e1;
    }
    
    .log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    
    .log-type {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .log-type.signup {
      background: #c6f6d5;
      color: #22543d;
    }
    
    .log-type.settings {
      background: #bee3f8;
      color: #2c5282;
    }
    
    .log-email {
      font-weight: 600;
      color: #1e3a5f;
      font-size: 1.1rem;
    }
    
    .log-timestamp {
      color: #666;
      font-size: 0.875rem;
    }
    
    .log-info {
      background: white;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1rem;
    }
    
    .log-info-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .log-info-item:last-child {
      border-bottom: none;
    }
    
    .log-info-label {
      font-weight: 600;
      color: #666;
      min-width: 150px;
    }
    
    .log-info-value {
      color: #1e3a5f;
      word-break: break-word;
      text-align: right;
      flex: 1;
    }
    
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: #666;
    }
    
    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 1rem;
      opacity: 0.5;
    }
    
    .loading {
      text-align: center;
      padding: 4rem 2rem;
      color: #666;
    }
    
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 User Activity Logs</h1>
      <div class="controls">
        <div class="filter-group">
          <label>Email Filter</label>
          <input type="text" id="emailFilter" placeholder="Filter by email...">
        </div>
        <div class="filter-group">
          <label>Type Filter</label>
          <select id="typeFilter">
            <option value="">All Types</option>
            <option value="signup">Signup</option>
            <option value="settings">Settings</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Limit</label>
          <select id="limitFilter">
            <option value="">All</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="loadLogs()">Refresh</button>
        <button class="btn btn-secondary" onclick="clearFilters()">Clear Filters</button>
      </div>
    </div>
    
    <div class="stats" id="stats">
      <div class="stat-card">
        <div class="stat-label">Total Logs</div>
        <div class="stat-value" id="totalLogs">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Signups</div>
        <div class="stat-value" id="signupCount">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Settings Updates</div>
        <div class="stat-value" id="settingsCount">-</div>
      </div>
    </div>
    
    <div class="content" id="content">
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading logs...</p>
      </div>
    </div>
  </div>
  
  <script>
    let allLogs = [];
    
    async function loadLogs() {
      const email = document.getElementById('emailFilter').value;
      const type = document.getElementById('typeFilter').value;
      const limit = document.getElementById('limitFilter').value;
      
      const params = new URLSearchParams();
      if (email) params.append('email', email);
      if (type) params.append('type', type);
      if (limit) params.append('limit', limit);
      
      const contentDiv = document.getElementById('content');
      contentDiv.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading logs...</p></div>';
      
      try {
        const response = await fetch('/api/user-logs?' + params.toString());
        const logs = await response.json();
        allLogs = logs;
        displayLogs(logs);
        updateStats(logs);
      } catch (error) {
        contentDiv.innerHTML = '<div class="empty-state"><p>Error loading logs: ' + error.message + '</p></div>';
      }
    }
    
    function displayLogs(logs) {
      const contentDiv = document.getElementById('content');
      
      if (logs.length === 0) {
        contentDiv.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"></path>
            </svg>
            <h2>No logs found</h2>
            <p>No user activity logs match your filters.</p>
          </div>
        \`;
        return;
      }
      
      contentDiv.innerHTML = logs.map(log => {
        const date = new Date(log.timestamp);
        const formattedDate = date.toLocaleString();
        
        let infoItems = '';
        if (log.userInfo) {
          infoItems = Object.entries(log.userInfo)
            .filter(([key, value]) => value !== null && value !== undefined && value !== '')
            .map(([key, value]) => \`
              <div class="log-info-item">
                <span class="log-info-label">\${formatKey(key)}:</span>
                <span class="log-info-value">\${formatValue(value)}</span>
              </div>
            \`).join('');
        }
        
        return \`
          <div class="log-entry \${log.type}">
            <div class="log-header">
              <div>
                <span class="log-type \${log.type}">\${log.type}</span>
                <span class="log-email">\${log.email}</span>
              </div>
              <span class="log-timestamp">\${formattedDate}</span>
            </div>
            <div class="log-info">
              \${infoItems || '<p style="color: #666;">No additional information</p>'}
            </div>
          </div>
        \`;
      }).join('');
    }
    
    function formatKey(key) {
      return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
    }
    
    function formatValue(value) {
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return value;
    }
    
    function updateStats(logs) {
      const total = logs.length;
      const signups = logs.filter(l => l.type === 'signup').length;
      const settings = logs.filter(l => l.type === 'settings').length;
      
      document.getElementById('totalLogs').textContent = total;
      document.getElementById('signupCount').textContent = signups;
      document.getElementById('settingsCount').textContent = settings;
    }
    
    function clearFilters() {
      document.getElementById('emailFilter').value = '';
      document.getElementById('typeFilter').value = '';
      document.getElementById('limitFilter').value = '';
      loadLogs();
    }
    
    // Auto-refresh every 30 seconds
    setInterval(loadLogs, 30000);
    
    // Load logs on page load
    loadLogs();
    
    // Add event listeners for filters
    document.getElementById('emailFilter').addEventListener('input', debounce(loadLogs, 500));
    document.getElementById('typeFilter').addEventListener('change', loadLogs);
    document.getElementById('limitFilter').addEventListener('change', loadLogs);
    
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
  </script>
</body>
</html>`;
  
  res.send(html);
});

// Serve static HTML page for comprehensive admin UI
app.get('/users', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel - POS System</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 1rem;
    }
    
    .admin-container {
      display: flex;
      max-width: 1800px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      min-height: calc(100vh - 2rem);
    }
    
    .sidebar {
      width: 280px;
      background: linear-gradient(180deg, #1e3a5f 0%, #2c5282 100%);
      color: white;
      padding: 1.5rem;
      overflow-y: auto;
      flex-shrink: 0;
    }
    
    .sidebar h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid rgba(255, 255, 255, 0.2);
    }
    
    .nav-section {
      margin-bottom: 2rem;
    }
    
    .nav-section-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      opacity: 0.7;
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    
    .nav-item {
      display: block;
      padding: 0.75rem 1rem;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      margin-bottom: 0.5rem;
      transition: all 0.2s;
      cursor: pointer;
      font-size: 0.9rem;
    }
    
    .nav-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .nav-item.active {
      background: rgba(255, 255, 255, 0.2);
      font-weight: 600;
    }
    
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%);
      color: white;
      padding: 1.5rem 2rem;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    }
    
    .header h1 {
      font-size: 1.75rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    
    .header-subtitle {
      opacity: 0.9;
      font-size: 0.9rem;
    }
    
    .content-area {
      flex: 1;
      padding: 2rem;
      overflow-y: auto;
      background: #f8f9fa;
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }
    
    .section-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    .section-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #1e3a5f;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .route-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    
    .route-card {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 1rem;
      transition: all 0.2s;
    }
    
    .route-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
    }
    
    .route-method {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-right: 0.5rem;
    }
    
    .method-get { background: #48bb78; color: white; }
    .method-post { background: #4299e1; color: white; }
    .method-put { background: #ed8936; color: white; }
    .method-delete { background: #e53e3e; color: white; }
    .method-options { background: #718096; color: white; }
    
    .route-path {
      font-family: 'Courier New', monospace;
      font-size: 0.875rem;
      color: #1e3a5f;
      font-weight: 600;
      margin: 0.5rem 0;
    }
    
    .route-description {
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 0.75rem;
    }
    
    .route-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    
    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-test {
      background: #4299e1;
      color: white;
    }
    
    .btn-test:hover {
      background: #3182ce;
    }
    
    .btn-view {
      background: #48bb78;
      color: white;
    }
    
    .btn-view:hover {
      background: #38a169;
    }
    
    .btn-small {
      padding: 0.375rem 0.75rem;
      font-size: 0.8rem;
    }
    
    /* User Management Styles */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    
    .stat-card {
      background: white;
      padding: 1rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .stat-label {
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 0.5rem;
    }
    
    .stat-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: #1e3a5f;
    }
    
    .controls {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    
    .filter-group label {
      font-size: 0.875rem;
      font-weight: 500;
      color: #666;
    }
    
    .filter-group input,
    .filter-group select {
      padding: 0.5rem;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      font-size: 0.9rem;
      color: #1e3a5f;
      background: white;
    }
    
    .filter-group select option {
      color: #1e3a5f;
      background: white;
    }
    
    .btn-primary {
      background: #1e3a5f;
      color: white;
    }
    
    .btn-primary:hover {
      background: #2c5282;
    }
    
    .btn-secondary {
      background: #e0e0e0;
      color: #1e3a5f;
    }
    
    .btn-secondary:hover {
      background: #d0d0d0;
    }
    
    .btn-danger {
      background: #e53e3e;
      color: white;
    }
    
    .btn-danger:hover {
      background: #c53030;
    }
    
    .view-toggle {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    
    .view-btn {
      padding: 0.5rem 1rem;
      border: 1px solid #e0e0e0;
      background: white;
      cursor: pointer;
      border-radius: 6px;
      font-size: 0.875rem;
    }
    
    .view-btn.active {
      background: #1e3a5f;
      color: white;
      border-color: #1e3a5f;
    }
    
    .user-entry {
      background: #f8f9fa;
      border-left: 4px solid #48bb78;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }
    
    .user-entry::before {
      content: '👆 Click to view profile';
      position: absolute;
      top: 0.5rem;
      right: 1rem;
      font-size: 0.75rem;
      color: #667eea;
      opacity: 0;
      transition: opacity 0.2s;
      font-weight: 500;
    }
    
    .user-entry:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      transform: translateX(4px);
      background: #ffffff;
      border-left-width: 6px;
    }
    
    .user-entry:hover::before {
      opacity: 1;
    }
    
    .user-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    
    .user-id {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      background: #c6f6d5;
      color: #22543d;
      margin-right: 0.5rem;
    }
    
    .user-email {
      font-weight: 600;
      color: #1e3a5f;
      font-size: 1.1rem;
    }
    
    /* User Detail View Styles */
    .user-detail-view {
      display: none;
    }
    
    .user-detail-view.active {
      display: block;
    }
    
    .user-detail-header {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
      padding: 2rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
    }
    
    .user-detail-header h2 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .back-btn {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    
    .back-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    
    .category-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 0.5rem;
    }
    
    .category-tab {
      padding: 0.75rem 1.5rem;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      color: #1e3a5f;
      transition: all 0.2s;
    }
    
    .category-tab:hover {
      background: #f8f9fa;
    }
    
    .category-tab.active {
      background: #1e3a5f;
      color: white;
      border-color: #1e3a5f;
    }
    
    /* Ensure all select elements have readable text */
    select {
      color: #1e3a5f !important;
    }
    
    select option {
      color: #1e3a5f !important;
      background: white !important;
    }
    
    /* For selects on dark backgrounds (header), keep white text */
    .header select,
    .header select option {
      color: white !important;
      background: rgba(255, 255, 255, 0.1) !important;
    }
    
    .category-content {
      display: none;
    }
    
    .category-content.active {
      display: block;
    }
    
    .route-item {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    
    .route-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    
    .route-item-method {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-right: 0.5rem;
    }
    
    .route-item-path {
      font-family: 'Courier New', monospace;
      font-weight: 600;
      color: #1e3a5f;
      font-size: 1rem;
    }
    
    .route-item-description {
      color: #666;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    
    .route-item-data {
      background: white;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1rem;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .data-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .data-item:last-child {
      border-bottom: none;
    }
    
    .data-label {
      font-weight: 600;
      color: #666;
      min-width: 150px;
    }
    
    .data-value {
      color: #1e3a5f;
      word-break: break-word;
      text-align: right;
      flex: 1;
    }
    
    .table-view {
      display: none;
    }
    
    .table-view.active {
      display: block;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
    }
    
    thead {
      background: #1e3a5f;
      color: white;
    }
    
    th, td {
      padding: 1rem;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    
    th {
      font-weight: 600;
      font-size: 0.875rem;
      text-transform: uppercase;
    }
    
    tbody tr:hover {
      background: #f8f9fa;
    }
    
    .loading {
      text-align: center;
      padding: 4rem 2rem;
      color: #666;
    }
    
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="admin-container">
    <div class="sidebar">
      <h2>🔧 Admin Panel</h2>
      
      <div class="nav-section">
        <div class="nav-section-title">Main</div>
        <a class="nav-item active" onclick="showTab('users')">👥 User Management</a>
        <a class="nav-item" onclick="showTab('logs')">📋 Activity Logs</a>
      </div>
      
      <div class="nav-section">
        <div class="nav-section-title">API Routes</div>
        <a class="nav-item" onclick="showTab('health')">💚 Health & System</a>
        <a class="nav-item" onclick="showTab('auth')">🔐 Authentication</a>
        <a class="nav-item" onclick="showTab('products')">📦 Products</a>
        <a class="nav-item" onclick="showTab('transactions')">💳 Transactions</a>
        <a class="nav-item" onclick="showTab('categories')">📁 Categories</a>
        <a class="nav-item" onclick="showTab('team')">👥 Team Members</a>
        <a class="nav-item" onclick="showTab('menu')">📄 Menu Analysis</a>
        <a class="nav-item" onclick="showTab('stripe')">💳 Stripe Terminal</a>
        <a class="nav-item" onclick="showTab('subscription')">💳 Subscriptions</a>
      </div>
      
      <div class="nav-section">
        <div class="nav-section-title">Links</div>
        <a href="/logs" class="nav-item" target="_blank">📋 Logs Page</a>
        <a href="/test-connection" class="nav-item" target="_blank">🧪 Test Connection</a>
        <a href="/api/health" class="nav-item" target="_blank">💚 Health Check</a>
      </div>
    </div>
    
    <div class="main-content">
      <div class="header">
        <h1 id="pageTitle">👥 User Management</h1>
        <div class="header-subtitle" id="pageSubtitle">Manage users, view stats, and access all backend routes</div>
      </div>
      
      <div class="content-area">
        <!-- User Management Tab -->
        <div id="tab-users" class="tab-content active">
          <!-- User List View -->
          <div id="userListView">
            <div class="controls">
              <div class="filter-group">
                <label>Email Filter</label>
                <input type="text" id="emailFilter" placeholder="Search by email...">
              </div>
              <div class="filter-group">
                <label>Limit</label>
                <select id="limitFilter">
                  <option value="">All</option>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <button class="btn btn-primary" onclick="loadUsers()">Refresh</button>
              <button class="btn btn-secondary" onclick="clearFilters()">Clear Filters</button>
            </div>
            
            <div class="stats" id="stats">
              <div class="stat-card">
                <div class="stat-label">Total Users</div>
                <div class="stat-value" id="totalUsers">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">New This Week</div>
                <div class="stat-value" id="newThisWeek">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">New This Month</div>
                <div class="stat-value" id="newThisMonth">-</div>
              </div>
            </div>
            
            <div class="view-toggle">
              <button class="view-btn active" onclick="setView('card')">Card View</button>
              <button class="view-btn" onclick="setView('table')">Table View</button>
            </div>
            
            <div id="cardView">
              <div id="content">
                <div class="loading">
                  <div class="spinner"></div>
                  <p>Loading users...</p>
                </div>
              </div>
            </div>
            
            <div id="tableView" class="table-view">
              <table id="usersTable">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Email</th>
                    <th>Created At</th>
                    <th>Days Since Signup</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="tableBody"></tbody>
              </table>
            </div>
          </div>
          
          <!-- User Detail View -->
          <div id="userDetailView" class="user-detail-view">
            <button class="back-btn" onclick="backToUserList()">← Back to Users</button>
            
            <div class="user-detail-header" id="userDetailHeader">
              <h2 id="userDetailTitle">👤 User Profile</h2>
              <div id="userDetailInfo"></div>
            </div>
            
            <div class="category-tabs" id="categoryTabs"></div>
            
            <div id="categoryContents"></div>
          </div>
        </div>
        
        <!-- Activity Logs Tab -->
        <div id="tab-logs" class="tab-content">
          <div class="section-card">
            <div class="section-title">📋 Activity Logs Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/user-logs</div>
                <div class="route-description">Get user activity logs with optional filters (email, type, limit)</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/user-logs?limit=10')">Test</button>
                  <a href="/logs" class="btn btn-view btn-small" target="_blank">View Page</a>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Health & System Tab -->
        <div id="tab-health" class="tab-content">
          <div class="section-card">
            <div class="section-title">💚 Health & System Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/health</div>
                <div class="route-description">Health check endpoint</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/health')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/test</div>
                <div class="route-description">Simple test endpoint</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/test')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/admin/reload-users</div>
                <div class="route-description">Reload users from file</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('POST', '/api/admin/reload-users')">Test</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Authentication Tab -->
        <div id="tab-auth" class="tab-content">
          <div class="section-card">
            <div class="section-title">🔐 Authentication Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/auth/signup</div>
                <div class="route-description">Create new user account. Body: { email, password }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use the test form or API client to test signup')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/auth/login</div>
                <div class="route-description">User login. Body: { email, password }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use the test form or API client to test login')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/auth/user</div>
                <div class="route-description">Get user by email. Query: ?email=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/auth/user?email=test@example.com')">Test</button>
                </div>
              </div>
            </div>
          </div>
          
          <div class="section-card">
            <div class="section-title">⚙️ User Settings Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/user/settings</div>
                <div class="route-description">Get user settings. Query: ?email=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/user/settings?email=test@example.com')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/user/settings</div>
                <div class="route-description">Save user settings. Body: { email, settings }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use API client to test with settings object')">Info</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Products Tab -->
        <div id="tab-products" class="tab-content">
          <div class="section-card">
            <div class="section-title">📦 Product Routes (All require userEmail)</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/products</div>
                <div class="route-description">Get all products. Query: ?userEmail=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/products?userEmail=test@example.com')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/products/:id</div>
                <div class="route-description">Get single product. Query: ?userEmail=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/products/1?userEmail=test@example.com')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/products</div>
                <div class="route-description">Create product (FormData with image). Requires: name, price, userEmail</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use FormData with: name, price, userEmail, image (optional)')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-put">PUT</span>
                <div class="route-path">/api/products/:id</div>
                <div class="route-description">Update product (FormData). Requires: userEmail</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use FormData to update product')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-delete">DELETE</span>
                <div class="route-path">/api/products/:id</div>
                <div class="route-description">Delete product. Query: ?userEmail=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('DELETE', '/api/products/1?userEmail=test@example.com')">Test</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Transactions Tab -->
        <div id="tab-transactions" class="tab-content">
          <div class="section-card">
            <div class="section-title">💳 Transaction Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/transactions</div>
                <div class="route-description">Get transactions. Query: ?userEmail=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/transactions?userEmail=test@example.com')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/transactions</div>
                <div class="route-description">Create transaction. Body: { customerName, paymentMethod, items[], subtotal, tax, total, userEmail }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use API client with transaction object')">Info</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Categories Tab -->
        <div id="tab-categories" class="tab-content">
          <div class="section-card">
            <div class="section-title">📁 Category Routes (Require userEmail)</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/categories</div>
                <div class="route-description">Get categories. Query: ?userEmail=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/categories?userEmail=test@example.com')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/categories</div>
                <div class="route-description">Save categories. Body: { userEmail, categories[] }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use API client with categories array')">Info</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Team Members Tab -->
        <div id="tab-team" class="tab-content">
          <div class="section-card">
            <div class="section-title">👥 Team Members Routes (Require userEmail)</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/team-members</div>
                <div class="route-description">Get team members. Query: ?userEmail=user@example.com</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/team-members?userEmail=test@example.com')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/team-members</div>
                <div class="route-description">Save team members. Body: { userEmail, teamMembers[] }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use API client with teamMembers array')">Info</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Menu Analysis Tab -->
        <div id="tab-menu" class="tab-content">
          <div class="section-card">
            <div class="section-title">📄 Menu Analysis Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/menu/analyze</div>
                <div class="route-description">Upload and analyze menu (FormData with 'menu' file). Supports images and PDFs (10MB max)</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use FormData to upload menu file')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/menu/status/:jobId</div>
                <div class="route-description">Get menu analysis job status</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/menu/status/job-1234567890')">Test</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Stripe Terminal Tab -->
        <div id="tab-stripe" class="tab-content">
          <div class="section-card">
            <div class="section-title">💳 Stripe Terminal Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/stripe-terminal/connection-token</div>
                <div class="route-description">Create connection token for Stripe Terminal</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('POST', '/api/stripe-terminal/connection-token')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/stripe-terminal/create-payment-intent</div>
                <div class="route-description">Create payment intent. Body: { amount, currency?, metadata? }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use API client with amount in dollars')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/stripe-terminal/process-payment</div>
                <div class="route-description">Process payment on reader. Body: { payment_intent_id, reader_id }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Requires payment_intent_id and reader_id')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/stripe-terminal/capture-payment</div>
                <div class="route-description">Capture payment intent. Body: { payment_intent_id }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Requires payment_intent_id')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/stripe-terminal/payment-intent/:id</div>
                <div class="route-description">Get payment intent status</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/stripe-terminal/payment-intent/pi_test123')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/stripe-terminal/cancel-payment</div>
                <div class="route-description">Cancel payment intent. Body: { payment_intent_id }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Requires payment_intent_id')">Info</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Subscriptions Tab -->
        <div id="tab-subscription" class="tab-content">
          <div class="section-card">
            <div class="section-title">💳 Subscription Routes</div>
            <div class="route-grid">
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/subscription/publishable-key</div>
                <div class="route-description">Get Stripe publishable key</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/subscription/publishable-key')">Test</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/subscription/create-subscription</div>
                <div class="route-description">Create Stripe Checkout session. Body: { email, discountCode? }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Creates checkout session with $99 setup + $30/month')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-post">POST</span>
                <div class="route-path">/api/subscription/update-status</div>
                <div class="route-description">Update subscription status. Body: { email, subscriptionStatus }</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="alert('Use API client with email and status')">Info</button>
                </div>
              </div>
              <div class="route-card">
                <span class="route-method method-get">GET</span>
                <div class="route-path">/api/subscription/verify-session</div>
                <div class="route-description">Verify Stripe checkout session. Query: ?session_id=xxx</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="testRoute('GET', '/api/subscription/verify-session?session_id=test')">Test</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    // Tab Management
    function showTab(tabName) {
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
      });
      
      // Remove active from all nav items
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
      });
      
      // Show selected tab
      document.getElementById('tab-' + tabName).classList.add('active');
      
      // Set active nav item
      event.target.classList.add('active');
      
      // Update page title
      const titles = {
        'users': '👥 User Management',
        'logs': '📋 Activity Logs',
        'health': '💚 Health & System',
        'auth': '🔐 Authentication',
        'products': '📦 Products',
        'transactions': '💳 Transactions',
        'categories': '📁 Categories',
        'team': '👥 Team Members',
        'menu': '📄 Menu Analysis',
        'stripe': '💳 Stripe Terminal',
        'subscription': '💳 Subscriptions'
      };
      
      const subtitles = {
        'users': 'Manage users, view stats, and access all backend routes',
        'logs': 'View and manage user activity logs',
        'health': 'System health checks and admin endpoints',
        'auth': 'Authentication and user settings endpoints',
        'products': 'Product management endpoints (require userEmail)',
        'transactions': 'Transaction management endpoints',
        'categories': 'Category management endpoints (require userEmail)',
        'team': 'Team member management endpoints (require userEmail)',
        'menu': 'AI-powered menu analysis endpoints',
        'stripe': 'Stripe Terminal payment processing endpoints',
        'subscription': 'Stripe subscription management endpoints'
      };
      
      document.getElementById('pageTitle').textContent = titles[tabName] || 'Admin Panel';
      document.getElementById('pageSubtitle').textContent = subtitles[tabName] || '';
    }
    
    // Test Route Function
    async function testRoute(method, path) {
      try {
        const options = {
          method: method,
          headers: {
            'Content-Type': 'application/json'
          }
        };
        
        const response = await fetch(path, options);
        const data = await response.json();
        
        const result = \`Method: \${method}\\nPath: \${path}\\nStatus: \${response.status} \${response.statusText}\\n\\nResponse:\\n\${JSON.stringify(data, null, 2)}\`;
        alert(result);
      } catch (error) {
        alert(\`Error testing route:\\n\${method} \${path}\\n\\n\${error.message}\`);
      }
    }
    
    // User Management Functions
    let allUsers = [];
    let currentView = 'card';
    
    async function loadUsers() {
      const email = document.getElementById('emailFilter').value;
      const limit = document.getElementById('limitFilter').value;
      
      const params = new URLSearchParams();
      if (email) params.append('email', email);
      if (limit) params.append('limit', limit);
      
      const contentDiv = document.getElementById('content');
      const tableBody = document.getElementById('tableBody');
      
      if (currentView === 'card') {
        contentDiv.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading users...</p></div>';
      } else {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;"><div class="spinner"></div><p>Loading users...</p></td></tr>';
      }
      
      try {
        const response = await fetch('/api/users?' + params.toString());
        const users = await response.json();
        allUsers = users;
        displayUsers(users);
        updateStats(users);
      } catch (error) {
        if (currentView === 'card') {
          contentDiv.innerHTML = '<div class="empty-state"><p>Error loading users: ' + error.message + '</p></div>';
        } else {
          tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #d32f2f;">Error loading users: ' + error.message + '</td></tr>';
        }
      }
    }
    
    function displayUsers(users) {
      if (currentView === 'card') {
        displayCardView(users);
      } else {
        displayTableView(users);
      }
    }
    
    function displayCardView(users) {
      const contentDiv = document.getElementById('content');
      
      if (users.length === 0) {
        contentDiv.innerHTML = '<div class="empty-state"><h2>No users found</h2><p>No users match your filters.</p></div>';
        return;
      }
      
      contentDiv.innerHTML = users.map(user => {
        const date = new Date(user.createdAt);
        const formattedDate = date.toLocaleString();
        const daysSince = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
        
        return \`
          <div class="user-entry" onclick="viewUserDetail(\${user.id}, '\${user.email}')">
            <div class="user-header">
              <div>
                <span class="user-id">ID: \${user.id}</span>
                <span class="user-email">\${user.email}</span>
              </div>
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <span style="color: #666; font-size: 0.875rem;">\${formattedDate}</span>
                <button class="btn btn-danger" onclick="event.stopPropagation(); deleteUser(\${user.id}, '\${user.email}')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Delete</button>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }
    
    function displayTableView(users) {
      const tableBody = document.getElementById('tableBody');
      
      if (users.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #666;">No users found</td></tr>';
        return;
      }
      
      tableBody.innerHTML = users.map(user => {
        const date = new Date(user.createdAt);
        const formattedDate = date.toLocaleString();
        const daysSince = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
        
        return \`
          <tr style="cursor: pointer;" onclick="viewUserDetail(\${user.id}, '\${user.email}')" onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background=''">
            <td>\${user.id}</td>
            <td>\${user.email}</td>
            <td>\${formattedDate}</td>
            <td>\${daysSince} day\${daysSince !== 1 ? 's' : ''}</td>
            <td>
              <button class="btn btn-danger" onclick="event.stopPropagation(); deleteUser(\${user.id}, '\${user.email}')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Delete</button>
            </td>
          </tr>
        \`;
      }).join('');
    }
    
    function updateStats(users) {
      const total = users.length;
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const newThisWeek = users.filter(u => new Date(u.createdAt) >= weekAgo).length;
      const newThisMonth = users.filter(u => new Date(u.createdAt) >= monthAgo).length;
      
      document.getElementById('totalUsers').textContent = total;
      document.getElementById('newThisWeek').textContent = newThisWeek;
      document.getElementById('newThisMonth').textContent = newThisMonth;
    }
    
    function clearFilters() {
      document.getElementById('emailFilter').value = '';
      document.getElementById('limitFilter').value = '';
      loadUsers();
    }
    
    function setView(view) {
      currentView = view;
      document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      document.getElementById('cardView').style.display = view === 'card' ? 'block' : 'none';
      document.getElementById('tableView').classList.toggle('active', view === 'table');
      
      displayUsers(allUsers);
    }
    
    async function deleteUser(userId, userEmail) {
      if (!confirm(\`Are you sure you want to delete the account for \${userEmail}? This action cannot be undone.\`)) {
        return;
      }
      
      try {
        const response = await fetch(\`/api/users/\${userId}\`, {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete user');
        }
        
        alert('User account deleted successfully');
        loadUsers();
      } catch (error) {
        alert('Error deleting user: ' + error.message);
        console.error('Delete user error:', error);
      }
    }
    
    // User Detail View Functions
    let currentUser = null;
    
    async function viewUserDetail(userId, userEmail) {
      try {
        console.log('Viewing user detail:', userId, userEmail);
        currentUser = { id: userId, email: userEmail };
        
        // Hide user list, show detail view
        const listView = document.getElementById('userListView');
        const detailView = document.getElementById('userDetailView');
        
        if (!listView || !detailView) {
          console.error('Could not find listView or detailView elements');
          alert('Error: Could not load user detail view');
          return;
        }
        
        listView.style.display = 'none';
        detailView.classList.add('active');
        
        // Scroll to top
        window.scrollTo(0, 0);
        
        // Load user info
        await loadUserDetailInfo(userEmail);
        
        // Setup category tabs and content
        setupCategoryTabs();
        
        // Activate first tab and content after a brief delay to ensure DOM is ready
        setTimeout(() => {
          const firstTab = document.querySelector('.category-tab');
          const firstContent = document.getElementById('category-overview');
          if (firstTab) {
            firstTab.classList.add('active');
          }
          if (firstContent) {
            firstContent.classList.add('active');
          }
          // Load overview data
          loadCategoryData('overview');
        }, 150);
      } catch (error) {
        console.error('Error in viewUserDetail:', error);
        alert('Error loading user profile: ' + error.message);
      }
    }
    
    function backToUserList() {
      document.getElementById('userListView').style.display = 'block';
      document.getElementById('userDetailView').classList.remove('active');
      currentUser = null;
    }
    
    async function loadUserDetailInfo(userEmail) {
      try {
        const [userResponse, settingsResponse, logsResponse] = await Promise.all([
          fetch(\`/api/auth/user?email=\${encodeURIComponent(userEmail)}\`),
          fetch(\`/api/user/settings?email=\${encodeURIComponent(userEmail)}\`),
          fetch(\`/api/user-logs?email=\${encodeURIComponent(userEmail)}&limit=1\`)
        ]);
        
        const user = await userResponse.json();
        const settings = settingsResponse.ok ? await settingsResponse.json() : null;
        const logs = logsResponse.ok ? await logsResponse.json() : [];
        
        const date = new Date(user.createdAt);
        const formattedDate = date.toLocaleString();
        const daysSince = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
        
        // Check if TOS was agreed (look for signup log)
        const hasSignupLog = logs.some(log => log.type === 'signup');
        const subscriptionStatus = user.subscriptionStatus || 'pending';
        const subscriptionBadge = subscriptionStatus === 'active' ? '✅ Active' : subscriptionStatus === 'pending' ? '⏳ Pending' : '❌ Inactive';
        
        document.getElementById('userDetailTitle').textContent = \`👤 \${user.email}\`;
        document.getElementById('userDetailInfo').innerHTML = \`
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1.5rem; margin-top: 1.5rem;">
            <div style="background: rgba(255, 255, 255, 0.1); padding: 1rem; border-radius: 8px;">
              <div style="font-size: 0.75rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">User ID</div>
              <div style="font-size: 1.5rem; font-weight: 600; margin-top: 0.5rem;">#\${user.id}</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); padding: 1rem; border-radius: 8px;">
              <div style="font-size: 0.75rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">Subscription</div>
              <div style="font-size: 1.5rem; font-weight: 600; margin-top: 0.5rem;">\${subscriptionBadge}</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); padding: 1rem; border-radius: 8px;">
              <div style="font-size: 0.75rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">TOS Agreed</div>
              <div style="font-size: 1.5rem; font-weight: 600; margin-top: 0.5rem;">\${hasSignupLog ? '✅ Yes' : '❌ No'}</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); padding: 1rem; border-radius: 8px;">
              <div style="font-size: 0.75rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">Member Since</div>
              <div style="font-size: 1.5rem; font-weight: 600; margin-top: 0.5rem;">\${daysSince} days</div>
            </div>
            <div style="background: rgba(255, 255, 255, 0.1); padding: 1rem; border-radius: 8px;">
              <div style="font-size: 0.75rem; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">Created</div>
              <div style="font-size: 0.875rem; font-weight: 500; margin-top: 0.5rem;">\${formattedDate}</div>
            </div>
          </div>
        \`;
        
        // Store user data globally for use in other functions
        window.currentUserData = { user, settings, logs };
      } catch (error) {
        console.error('Error loading user info:', error);
        document.getElementById('userDetailInfo').innerHTML = \`<div style="color: #e53e3e; padding: 1rem;">Error loading user info: \${error.message}</div>\`;
      }
    }
    
    function setupCategoryTabs() {
      const categories = [
        { id: 'overview', label: '📋 Overview', icon: '📋' },
        { id: 'products', label: '📦 Products', icon: '📦' },
        { id: 'transactions', label: '💳 Transactions', icon: '💳' },
        { id: 'categories', label: '📁 Categories', icon: '📁' },
        { id: 'team', label: '👥 Team Members', icon: '👥' },
        { id: 'settings', label: '⚙️ Settings', icon: '⚙️' },
        { id: 'logs', label: '📋 Activity Logs', icon: '📋' },
        { id: 'routes', label: '🔗 All Routes', icon: '🔗' }
      ];
      
      const tabsContainer = document.getElementById('categoryTabs');
      const contentContainer = document.getElementById('categoryContents');
      
      tabsContainer.innerHTML = categories.map(cat => 
        \`<button class="category-tab" onclick="showCategory('\${cat.id}'); this.classList.add('active');">\${cat.label}</button>\`
      ).join('');
      
      contentContainer.innerHTML = categories.map(cat => 
        \`<div id="category-\${cat.id}" class="category-content"><div class="loading"><div class="spinner"></div><p>Loading...</p></div></div>\`
      ).join('');
    }
    
    async function showCategory(categoryId) {
      // Update active tab
      document.querySelectorAll('.category-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      // Find and activate the clicked tab
      let clickedTab = null;
      if (typeof event !== 'undefined' && event.target) {
        clickedTab = event.target;
      }
      
      if (clickedTab && clickedTab.classList.contains('category-tab')) {
        clickedTab.classList.add('active');
      } else {
        // Fallback: find tab by text content
        document.querySelectorAll('.category-tab').forEach(tab => {
          const tabText = tab.textContent.toLowerCase();
          const categoryText = categoryId.toLowerCase();
          if (tabText.includes(categoryText)) {
            tab.classList.add('active');
          }
        });
      }
      
      // Hide all category contents
      document.querySelectorAll('.category-content').forEach(content => {
        content.classList.remove('active');
      });
      
      // Show selected category
      const categoryContent = document.getElementById(\`category-\${categoryId}\`);
      if (categoryContent) {
        categoryContent.classList.add('active');
        
        // Load category data
        await loadCategoryData(categoryId);
      }
    }
    
    function getCategoryLabel(categoryId) {
      const labels = {
        'overview': '📋 Overview',
        'products': '📦 Products',
        'transactions': '💳 Transactions',
        'categories': '📁 Categories',
        'team': '👥 Team Members',
        'settings': '⚙️ Settings',
        'logs': '📋 Activity Logs',
        'routes': '🔗 All Routes'
      };
      return labels[categoryId] || categoryId;
    }
    
    async function loadCategoryData(categoryId) {
      const categoryContent = document.getElementById(\`category-\${categoryId}\`);
      const userEmail = currentUser.email;
      
      try {
        switch(categoryId) {
          case 'overview':
            await loadOverviewCategory(categoryContent, userEmail);
            break;
          case 'products':
            await loadProductsCategory(categoryContent, userEmail);
            break;
          case 'transactions':
            await loadTransactionsCategory(categoryContent, userEmail);
            break;
          case 'categories':
            await loadCategoriesCategory(categoryContent, userEmail);
            break;
          case 'team':
            await loadTeamCategory(categoryContent, userEmail);
            break;
          case 'settings':
            await loadSettingsCategory(categoryContent, userEmail);
            break;
          case 'logs':
            await loadLogsCategory(categoryContent, userEmail);
            break;
          case 'routes':
            await loadRoutesCategory(categoryContent, userEmail);
            break;
        }
      } catch (error) {
        categoryContent.innerHTML = \`<div class="empty-state"><p>Error loading \${categoryId}: \${error.message}</p></div>\`;
      }
    }
    
    async function loadOverviewCategory(container, userEmail) {
      try {
        const userData = window.currentUserData || {};
        const user = userData.user || {};
        const settings = userData.settings || null;
        
        // Get additional data
        const [productsRes, transactionsRes, categoriesRes, teamRes, logsRes] = await Promise.all([
          fetch(\`/api/products?userEmail=\${encodeURIComponent(userEmail)}\`).catch(() => ({ ok: false })),
          fetch(\`/api/transactions?userEmail=\${encodeURIComponent(userEmail)}\`).catch(() => ({ ok: false })),
          fetch(\`/api/categories?userEmail=\${encodeURIComponent(userEmail)}\`).catch(() => ({ ok: false })),
          fetch(\`/api/team-members?userEmail=\${encodeURIComponent(userEmail)}\`).catch(() => ({ ok: false })),
          fetch(\`/api/user-logs?email=\${encodeURIComponent(userEmail)}&limit=5\`).catch(() => ({ ok: false }))
        ]);
        
        const products = productsRes.ok ? await productsRes.json() : [];
        const transactions = transactionsRes.ok ? await transactionsRes.json() : [];
        const categories = categoriesRes.ok ? await categoriesRes.json() : [];
        const teamMembers = teamRes.ok ? await teamRes.json() : [];
        const logs = logsRes.ok ? await logsRes.json() : [];
        
        const subscriptionStatus = user.subscriptionStatus || 'pending';
        const hasTOS = logs.some(log => log.type === 'signup');
        
        container.innerHTML = \`
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
            <!-- Account Information -->
            <div class="section-card">
              <div class="section-title">👤 Account Information</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Email:</span>
                  <span class="data-value">\${user.email || 'N/A'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">User ID:</span>
                  <span class="data-value">#\${user.id || 'N/A'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Created:</span>
                  <span class="data-value">\${user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Subscription:</span>
                  <span class="data-value">
                    <span style="padding: 0.25rem 0.5rem; border-radius: 4px; background: \${subscriptionStatus === 'active' ? '#c6f6d5' : subscriptionStatus === 'pending' ? '#fed7aa' : '#fed7d7'}; color: \${subscriptionStatus === 'active' ? '#22543d' : subscriptionStatus === 'pending' ? '#7c2d12' : '#742a2a'};">
                      \${subscriptionStatus.toUpperCase()}
                    </span>
                  </span>
                </div>
                <div class="data-item">
                  <span class="data-label">TOS Agreed:</span>
                  <span class="data-value">\${hasTOS ? '✅ Yes' : '❌ No'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Stripe Customer ID:</span>
                  <span class="data-value" style="font-family: monospace; font-size: 0.875rem;">\${user.stripeCustomerId || 'Not set'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Stripe Subscription ID:</span>
                  <span class="data-value" style="font-family: monospace; font-size: 0.875rem;">\${user.stripeSubscriptionId || 'Not set'}</span>
                </div>
              </div>
            </div>
            
            <!-- Business Information -->
            <div class="section-card">
              <div class="section-title">🏢 Business Information</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Owner Name:</span>
                  <span class="data-value">\${settings?.ownerName || 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Manager Name:</span>
                  <span class="data-value">\${settings?.managerName || 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Location:</span>
                  <span class="data-value">\${settings?.location || 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Account Email:</span>
                  <span class="data-value">\${settings?.accountEmail || 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Account Password:</span>
                  <span class="data-value">\${settings?.accountPassword ? '🔒 Set' : 'Not set'}</span>
                </div>
              </div>
            </div>
            
            <!-- Payment Information -->
            <div class="section-card">
              <div class="section-title">💳 Payment Information</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Cardholder Name:</span>
                  <span class="data-value">\${settings?.cardholderName || 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Card Number:</span>
                  <span class="data-value" style="font-family: monospace;">\${settings?.cardNumber ? settings.cardNumber.replace(/\d(?=\d{4})/g, '*') : 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Card Expiry:</span>
                  <span class="data-value">\${settings?.cardExpiry || 'Not provided'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Card CVC:</span>
                  <span class="data-value">\${settings?.cardCVC ? '🔒 Set' : 'Not set'}</span>
                </div>
              </div>
            </div>
            
            <!-- Statistics -->
            <div class="section-card">
              <div class="section-title">📊 Statistics</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Products:</span>
                  <span class="data-value" style="font-size: 1.25rem; font-weight: 600; color: #1e3a5f;">\${products.length}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Transactions:</span>
                  <span class="data-value" style="font-size: 1.25rem; font-weight: 600; color: #1e3a5f;">\${transactions.length}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Categories:</span>
                  <span class="data-value" style="font-size: 1.25rem; font-weight: 600; color: #1e3a5f;">\${categories.length}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Team Members:</span>
                  <span class="data-value" style="font-size: 1.25rem; font-weight: 600; color: #1e3a5f;">\${teamMembers.length}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Activity Logs:</span>
                  <span class="data-value" style="font-size: 1.25rem; font-weight: 600; color: #1e3a5f;">\${logs.length}+</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Quick Actions -->
          <div class="section-card" style="margin-top: 1.5rem;">
            <div class="section-title">⚡ Quick Actions</div>
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
              <button class="btn btn-primary" onclick="showCategory('settings')">View Full Settings</button>
              <button class="btn btn-primary" onclick="showCategory('products')">View Products</button>
              <button class="btn btn-primary" onclick="showCategory('transactions')">View Transactions</button>
              <button class="btn btn-primary" onclick="showCategory('logs')">View Activity Logs</button>
              <a href="/logs?email=\${encodeURIComponent(userEmail)}" class="btn btn-view" target="_blank">Open Logs Page</a>
            </div>
          </div>
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading overview: \${error.message}</p></div>\`;
      }
    }
    
    async function loadProductsCategory(container, userEmail) {
      const routes = [
        { method: 'GET', path: '/api/products', description: 'Get all products for user', query: \`?userEmail=\${encodeURIComponent(userEmail)}\` },
        { method: 'GET', path: '/api/products/:id', description: 'Get single product', query: \`?userEmail=\${encodeURIComponent(userEmail)}\` },
        { method: 'POST', path: '/api/products', description: 'Create product (FormData with image)', query: '' },
        { method: 'PUT', path: '/api/products/:id', description: 'Update product (FormData)', query: '' },
        { method: 'DELETE', path: '/api/products/:id', description: 'Delete product', query: \`?userEmail=\${encodeURIComponent(userEmail)}\` }
      ];
      
      try {
        const response = await fetch(\`/api/products?userEmail=\${encodeURIComponent(userEmail)}\`);
        const products = await response.json();
        
        container.innerHTML = \`
          <div class="section-card">
            <div class="section-title">📦 Product Routes</div>
            <div class="route-grid">
              \${routes.map(route => \`
                <div class="route-card">
                  <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                  <div class="route-path">\${route.path}</div>
                  <div class="route-description">\${route.description}</div>
                  <div class="route-actions">
                    <button class="btn btn-test btn-small" onclick="\${route.method === 'GET' && route.query ? \`testRoute('\${route.method}', '\${route.path}\${route.query}')\` : \"alert('Use API client or FormData for this endpoint')\"}">\${route.method === 'GET' && route.query ? 'Test' : 'Info'}</button>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
          <div class="section-card">
            <div class="section-title">User Products (\${products.length})</div>
            <div class="route-item-data">
              \${products.length === 0 ? '<p style="text-align: center; color: #666; padding: 2rem;">No products found</p>' : products.map(p => \`
                <div class="data-item">
                  <span class="data-label">\${p.name}</span>
                  <span class="data-value">$\${p.price.toFixed(2)}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading products: \${error.message}</p></div>\`;
      }
    }
    
    async function loadTransactionsCategory(container, userEmail) {
      const routes = [
        { method: 'GET', path: '/api/transactions', description: 'Get all transactions for user', query: \`?userEmail=\${encodeURIComponent(userEmail)}\` },
        { method: 'POST', path: '/api/transactions', description: 'Create new transaction', query: '' }
      ];
      
      try {
        const response = await fetch(\`/api/transactions?userEmail=\${encodeURIComponent(userEmail)}\`);
        const transactions = await response.json();
        
        container.innerHTML = \`
          <div class="section-card">
            <div class="section-title">💳 Transaction Routes</div>
            <div class="route-grid">
              \${routes.map(route => \`
                <div class="route-card">
                  <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                  <div class="route-path">\${route.path}</div>
                  <div class="route-description">\${route.description}</div>
                  <div class="route-actions">
                    <button class="btn btn-test btn-small" onclick="\${route.method === 'GET' ? \`testRoute('\${route.method}', '\${route.path}\${route.query}')\` : \"alert('Use API client with transaction object')\"}">\${route.method === 'GET' ? 'Test' : 'Info'}</button>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
          <div class="section-card">
            <div class="section-title">User Transactions (\${transactions.length})</div>
            <div class="route-item-data">
              \${transactions.length === 0 ? '<p style="text-align: center; color: #666; padding: 2rem;">No transactions found</p>' : transactions.slice(0, 10).map(t => \`
                <div class="data-item">
                  <span class="data-label">\${t.customerName} - \${new Date(t.timestamp).toLocaleString()}</span>
                  <span class="data-value">$\${t.total.toFixed(2)}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading transactions: \${error.message}</p></div>\`;
      }
    }
    
    async function loadCategoriesCategory(container, userEmail) {
      const routes = [
        { method: 'GET', path: '/api/categories', description: 'Get categories for user', query: \`?userEmail=\${encodeURIComponent(userEmail)}\` },
        { method: 'POST', path: '/api/categories', description: 'Save categories for user', query: '' }
      ];
      
      try {
        const response = await fetch(\`/api/categories?userEmail=\${encodeURIComponent(userEmail)}\`);
        const categories = await response.json();
        
        container.innerHTML = \`
          <div class="section-card">
            <div class="section-title">📁 Category Routes</div>
            <div class="route-grid">
              \${routes.map(route => \`
                <div class="route-card">
                  <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                  <div class="route-path">\${route.path}</div>
                  <div class="route-description">\${route.description}</div>
                  <div class="route-actions">
                    <button class="btn btn-test btn-small" onclick="\${route.method === 'GET' ? \`testRoute('\${route.method}', '\${route.path}\${route.query}')\` : \"alert('Use API client with categories array')\"}">\${route.method === 'GET' ? 'Test' : 'Info'}</button>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
          <div class="section-card">
            <div class="section-title">User Categories (\${categories.length})</div>
            <div class="route-item-data">
              \${categories.map(cat => \`
                <div class="data-item">
                  <span class="data-label">\${cat}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading categories: \${error.message}</p></div>\`;
      }
    }
    
    async function loadTeamCategory(container, userEmail) {
      const routes = [
        { method: 'GET', path: '/api/team-members', description: 'Get team members for user', query: \`?userEmail=\${encodeURIComponent(userEmail)}\` },
        { method: 'POST', path: '/api/team-members', description: 'Save team members for user', query: '' }
      ];
      
      try {
        const response = await fetch(\`/api/team-members?userEmail=\${encodeURIComponent(userEmail)}\`);
        const teamMembers = await response.json();
        
        container.innerHTML = \`
          <div class="section-card">
            <div class="section-title">👥 Team Members Routes</div>
            <div class="route-grid">
              \${routes.map(route => \`
                <div class="route-card">
                  <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                  <div class="route-path">\${route.path}</div>
                  <div class="route-description">\${route.description}</div>
                  <div class="route-actions">
                    <button class="btn btn-test btn-small" onclick="\${route.method === 'GET' ? \`testRoute('\${route.method}', '\${route.path}\${route.query}')\` : \"alert('Use API client with teamMembers array')\"}">\${route.method === 'GET' ? 'Test' : 'Info'}</button>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
          <div class="section-card">
            <div class="section-title">Team Members (\${teamMembers.length})</div>
            <div class="route-item-data">
              \${teamMembers.length === 0 ? '<p style="text-align: center; color: #666; padding: 2rem;">No team members found</p>' : teamMembers.map(tm => \`
                <div class="data-item">
                  <span class="data-label">\${tm.name || 'Unnamed'}</span>
                  <span class="data-value">\${tm.role || 'Member'}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading team members: \${error.message}</p></div>\`;
      }
    }
    
    async function loadSettingsCategory(container, userEmail) {
      const routes = [
        { method: 'GET', path: '/api/user/settings', description: 'Get user settings', query: \`?email=\${encodeURIComponent(userEmail)}\` },
        { method: 'POST', path: '/api/user/settings', description: 'Save user settings', query: '' }
      ];
      
      try {
        const response = await fetch(\`/api/user/settings?email=\${encodeURIComponent(userEmail)}\`);
        const settings = response.ok ? await response.json() : null;
        
        container.innerHTML = \`
          <div class="section-card">
            <div class="section-title">⚙️ User Settings Routes</div>
            <div class="route-grid">
              \${routes.map(route => \`
                <div class="route-card">
                  <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                  <div class="route-path">\${route.path}</div>
                  <div class="route-description">\${route.description}</div>
                  <div class="route-actions">
                    <button class="btn btn-test btn-small" onclick="\${route.method === 'GET' ? \`testRoute('\${route.method}', '\${route.path}\${route.query}')\` : \"alert('Use API client with settings object')\"}">\${route.method === 'GET' ? 'Test' : 'Info'}</button>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
          \${!settings ? \`
          <div class="section-card">
            <div class="section-title">Current Settings</div>
            <div style="text-align: center; padding: 3rem; color: #666;">
              <p style="font-size: 1.125rem; margin-bottom: 1rem;">No settings found for this user</p>
              <p style="color: #999;">Settings will appear here once the user completes their profile setup.</p>
            </div>
          </div>
          \` : \`
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; margin-top: 1.5rem;">
            <!-- Business Information -->
            <div class="section-card">
              <div class="section-title">🏢 Business Information</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Owner Name:</span>
                  <span class="data-value">\${settings.ownerName || '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Manager Name:</span>
                  <span class="data-value">\${settings.managerName || '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Location:</span>
                  <span class="data-value">\${settings.location || '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Account Email:</span>
                  <span class="data-value">\${settings.accountEmail || '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Account Password:</span>
                  <span class="data-value">\${settings.accountPassword ? '🔒 Password is set' : '<span style="color: #999; font-style: italic;">Not set</span>'}</span>
                </div>
              </div>
            </div>
            
            <!-- Payment Information -->
            <div class="section-card">
              <div class="section-title">💳 Payment Information</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Cardholder Name:</span>
                  <span class="data-value">\${settings.cardholderName || '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Card Number:</span>
                  <span class="data-value" style="font-family: monospace;">\${settings.cardNumber ? settings.cardNumber.replace(/\\d(?=\\d{4})/g, '*') : '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Card Expiry:</span>
                  <span class="data-value">\${settings.cardExpiry || '<span style="color: #999; font-style: italic;">Not provided</span>'}</span>
                </div>
                <div class="data-item">
                  <span class="data-label">Card CVC:</span>
                  <span class="data-value">\${settings.cardCVC ? '🔒 CVC is set' : '<span style="color: #999; font-style: italic;">Not set</span>'}</span>
                </div>
              </div>
            </div>
            
            <!-- Metadata -->
            <div class="section-card">
              <div class="section-title">📋 Metadata</div>
              <div class="route-item-data">
                <div class="data-item">
                  <span class="data-label">Last Updated:</span>
                  <span class="data-value">\${settings.updatedAt ? new Date(settings.updatedAt).toLocaleString() : 'Never'}</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Raw Settings -->
          <div class="section-card" style="margin-top: 1.5rem;">
            <div class="section-title">🔧 Raw Settings Data</div>
            <details style="margin-top: 1rem;">
              <summary style="cursor: pointer; padding: 0.75rem; background: #f8f9fa; border-radius: 6px; font-weight: 500;">Click to view raw JSON data</summary>
              <pre style="background: #1e3a5f; color: #fff; padding: 1.5rem; border-radius: 8px; overflow-x: auto; margin-top: 1rem; font-size: 0.875rem; line-height: 1.6;">\${JSON.stringify(settings, null, 2)}</pre>
            </details>
          </div>
          \`}
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading settings: \${error.message}</p></div>\`;
      }
    }
    
    async function loadLogsCategory(container, userEmail) {
      const routes = [
        { method: 'GET', path: '/api/user-logs', description: 'Get user activity logs', query: \`?email=\${encodeURIComponent(userEmail)}\` }
      ];
      
      try {
        const response = await fetch(\`/api/user-logs?email=\${encodeURIComponent(userEmail)}\`);
        const logs = await response.json();
        
        container.innerHTML = \`
          <div class="section-card">
            <div class="section-title">📋 Activity Logs Routes</div>
            <div class="route-grid">
              \${routes.map(route => \`
                <div class="route-card">
                  <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                  <div class="route-path">\${route.path}</div>
                  <div class="route-description">\${route.description}</div>
                  <div class="route-actions">
                    <button class="btn btn-test btn-small" onclick="testRoute('\${route.method}', '\${route.path}\${route.query}')">Test</button>
                    <a href="/logs?email=\${encodeURIComponent(userEmail)}" class="btn btn-view btn-small" target="_blank">View Page</a>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
          <div class="section-card">
            <div class="section-title">User Activity Logs (\${logs.length})</div>
            <div class="route-item-data">
              \${logs.length === 0 ? '<p style="text-align: center; color: #666; padding: 2rem;">No logs found</p>' : logs.map(log => \`
                <div class="route-item">
                  <div class="route-item-header">
                    <div>
                      <span class="route-item-method method-\${log.type === 'signup' ? 'post' : 'post'}" style="background: \${log.type === 'signup' ? '#48bb78' : '#4299e1'};">\${log.type.toUpperCase()}</span>
                      <span style="font-weight: 600; color: #1e3a5f;">\${log.email}</span>
                    </div>
                    <span style="color: #666; font-size: 0.875rem;">\${new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div class="route-item-data">
                    \${Object.entries(log.userInfo || {}).map(([key, value]) => \`
                      <div class="data-item">
                        <span class="data-label">\${key}:</span>
                        <span class="data-value">\${typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                      </div>
                    \`).join('')}
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      } catch (error) {
        container.innerHTML = \`<div class="empty-state"><p>Error loading logs: \${error.message}</p></div>\`;
      }
    }
    
    async function loadRoutesCategory(container, userEmail) {
      const allRoutes = [
        { category: 'Static & Pages', routes: [
          { method: 'GET', path: '/uploads/*', description: 'Serve uploaded images' },
          { method: 'GET', path: '/test-connection', description: 'Test connection page' },
          { method: 'GET', path: '/logs', description: 'User activity logs UI' },
          { method: 'GET', path: '/users', description: 'User management UI' }
        ]},
        { category: 'Health & System', routes: [
          { method: 'GET', path: '/api/health', description: 'Health check endpoint' },
          { method: 'GET', path: '/api/test', description: 'Simple test endpoint' },
          { method: 'POST', path: '/api/admin/reload-users', description: 'Reload users from file' }
        ]},
        { category: 'Authentication', routes: [
          { method: 'POST', path: '/api/auth/signup', description: 'Create new user account' },
          { method: 'POST', path: '/api/auth/login', description: 'User login' },
          { method: 'GET', path: '/api/auth/user', description: 'Get user by email', query: \`?email=\${encodeURIComponent(userEmail)}\` }
        ]},
        { category: 'Stripe Terminal', routes: [
          { method: 'POST', path: '/api/stripe-terminal/connection-token', description: 'Create connection token' },
          { method: 'POST', path: '/api/stripe-terminal/create-payment-intent', description: 'Create payment intent' },
          { method: 'POST', path: '/api/stripe-terminal/process-payment', description: 'Process payment on reader' },
          { method: 'POST', path: '/api/stripe-terminal/capture-payment', description: 'Capture payment intent' },
          { method: 'GET', path: '/api/stripe-terminal/payment-intent/:id', description: 'Get payment intent status' },
          { method: 'POST', path: '/api/stripe-terminal/cancel-payment', description: 'Cancel payment intent' }
        ]},
        { category: 'Subscriptions', routes: [
          { method: 'GET', path: '/api/subscription/publishable-key', description: 'Get Stripe publishable key' },
          { method: 'POST', path: '/api/subscription/create-subscription', description: 'Create Stripe Checkout session' },
          { method: 'POST', path: '/api/subscription/update-status', description: 'Update subscription status' },
          { method: 'GET', path: '/api/subscription/verify-session', description: 'Verify Stripe checkout session' }
        ]},
        { category: 'Menu Analysis', routes: [
          { method: 'POST', path: '/api/menu/analyze', description: 'Upload and analyze menu file' },
          { method: 'GET', path: '/api/menu/status/:jobId', description: 'Get menu analysis job status' }
        ]}
      ];
      
      container.innerHTML = allRoutes.map(section => \`
        <div class="section-card">
          <div class="section-title">\${section.category}</div>
          <div class="route-grid">
            \${section.routes.map(route => \`
              <div class="route-card">
                <span class="route-method method-\${route.method.toLowerCase()}">\${route.method}</span>
                <div class="route-path">\${route.path}</div>
                <div class="route-description">\${route.description}</div>
                <div class="route-actions">
                  <button class="btn btn-test btn-small" onclick="\${route.query ? \`testRoute('\${route.method}', '\${route.path}\${route.query}')\` : route.method === 'GET' && !route.path.includes(':') && !route.path.includes('*') ? \`testRoute('\${route.method}', '\${route.path}')\` : \"alert('Use API client or browser for this endpoint')\"}">\${route.query || (route.method === 'GET' && !route.path.includes(':') && !route.path.includes('*')) ? 'Test' : 'Info'}</button>
                </div>
              </div>
            \`).join('')}
          </div>
        </div>
      \`).join('');
    }
    
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
    
    // Auto-refresh users every 30 seconds
    setInterval(() => {
      if (document.getElementById('tab-users').classList.contains('active')) {
        loadUsers();
      }
    }, 30000);
    
    // Load users on page load
    loadUsers();
    
    // Add event listeners for filters
    const emailFilter = document.getElementById('emailFilter');
    const limitFilter = document.getElementById('limitFilter');
    if (emailFilter) emailFilter.addEventListener('input', debounce(loadUsers, 500));
    if (limitFilter) limitFilter.addEventListener('change', loadUsers);
  </script>
</body>
</html>`;
  
  res.send(html);
});

// Routes
// Chrome DevTools endpoint (prevents CSP errors)
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.json({});
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Backend server is running',
    port: PORT,
    protocol: 'HTTPS'
  });
});

// File-based product storage for persistence (user-specific)
const productsFile = path.join(__dirname, 'products.json');

// Load products from file (stored as { userEmail: [products] })
let productsByUser = {};
function loadProducts() {
  try {
    if (fs.existsSync(productsFile)) {
      const data = fs.readFileSync(productsFile, 'utf8');
      const parsed = JSON.parse(data);
      // Support both old format (array) and new format (object)
      if (Array.isArray(parsed)) {
        // Migrate old format: clear it (old data is not user-specific)
        productsByUser = {};
        console.log('📦 Migrated from old products format - old data cleared for security');
      } else {
        productsByUser = parsed;
      }
      const totalProducts = Object.values(productsByUser).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`📦 Loaded products for ${Object.keys(productsByUser).length} users (${totalProducts} total products)`);
    } else {
      productsByUser = {};
      console.log('📦 No products file found, starting with empty object');
    }
  } catch (error) {
    console.error('❌ Error loading products:', error);
    productsByUser = {};
  }
}

// Save products to file
function saveProducts() {
  try {
    fs.writeFileSync(productsFile, JSON.stringify(productsByUser, null, 2), 'utf8');
    const totalProducts = Object.values(productsByUser).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`💾 Saved products for ${Object.keys(productsByUser).length} users (${totalProducts} total products)`);
  } catch (error) {
    console.error('❌ Error saving products:', error);
  }
}

// Helper to get products for a user
function getUserProducts(userEmail) {
  if (!userEmail) return [];
  return productsByUser[userEmail.toLowerCase()] || [];
}

// Helper to set products for a user
function setUserProducts(userEmail, products) {
  if (!userEmail) return;
  productsByUser[userEmail.toLowerCase()] = products;
  saveProducts();
}

// Load products on startup
loadProducts();

// File-based transaction storage for persistence
const transactionsFile = path.join(__dirname, 'transactions.json');

// Load transactions from file
let transactions = [];
function loadTransactions() {
  try {
    if (fs.existsSync(transactionsFile)) {
      const data = fs.readFileSync(transactionsFile, 'utf8');
      transactions = JSON.parse(data);
      console.log(`💳 Loaded ${transactions.length} transactions from file`);
    } else {
      transactions = [];
      console.log('💳 No transactions file found, starting with empty array');
    }
  } catch (error) {
    console.error('❌ Error loading transactions:', error);
    transactions = [];
  }
}

// Save transactions to file
function saveTransactions() {
  try {
    fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2), 'utf8');
    console.log(`💾 Saved ${transactions.length} transactions to file`);
  } catch (error) {
    console.error('❌ Error saving transactions:', error);
  }
}

// Load transactions on startup
loadTransactions();

// File-based categories storage for persistence (user-specific)
const categoriesFile = path.join(__dirname, 'categories.json');

// Load categories from file (stored as { userEmail: [categories] })
let categoriesByUser = {};
function loadCategories() {
  try {
    if (fs.existsSync(categoriesFile)) {
      const data = fs.readFileSync(categoriesFile, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Migrate old format: clear it (old data is not user-specific)
        categoriesByUser = {};
        console.log('📁 Migrated from old categories format - old data cleared for security');
      } else {
        categoriesByUser = parsed;
      }
      const totalCategories = Object.values(categoriesByUser).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`📁 Loaded categories for ${Object.keys(categoriesByUser).length} users (${totalCategories} total categories)`);
    } else {
      categoriesByUser = {};
      console.log('📁 No categories file found, starting with empty object');
    }
  } catch (error) {
    console.error('❌ Error loading categories:', error);
    categoriesByUser = {};
  }
}

// Save categories to file
function saveCategories() {
  try {
    fs.writeFileSync(categoriesFile, JSON.stringify(categoriesByUser, null, 2), 'utf8');
    const totalCategories = Object.values(categoriesByUser).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`💾 Saved categories for ${Object.keys(categoriesByUser).length} users (${totalCategories} total categories)`);
  } catch (error) {
    console.error('❌ Error saving categories:', error);
  }
}

// Helper to get categories for a user
function getUserCategories(userEmail) {
  if (!userEmail) return ['All'];
  const userCats = categoriesByUser[userEmail.toLowerCase()];
  return userCats && userCats.length > 0 ? userCats : ['All'];
}

// Helper to set categories for a user
function setUserCategories(userEmail, categories) {
  if (!userEmail) return;
  categoriesByUser[userEmail.toLowerCase()] = categories;
  saveCategories();
}

// Load categories on startup
loadCategories();

// File-based team members storage for persistence (user-specific)
const teamMembersFile = path.join(__dirname, 'teamMembers.json');

// Load team members from file (stored as { userEmail: [teamMembers] })
let teamMembersByUser = {};
function loadTeamMembers() {
  try {
    if (fs.existsSync(teamMembersFile)) {
      const data = fs.readFileSync(teamMembersFile, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Migrate old format: clear it (old data is not user-specific)
        teamMembersByUser = {};
        console.log('👥 Migrated from old team members format - old data cleared for security');
      } else {
        teamMembersByUser = parsed;
      }
      const totalMembers = Object.values(teamMembersByUser).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`👥 Loaded team members for ${Object.keys(teamMembersByUser).length} users (${totalMembers} total members)`);
    } else {
      teamMembersByUser = {};
      console.log('👥 No team members file found, starting with empty object');
    }
  } catch (error) {
    console.error('❌ Error loading team members:', error);
    teamMembersByUser = {};
  }
}

// Save team members to file
function saveTeamMembers() {
  try {
    fs.writeFileSync(teamMembersFile, JSON.stringify(teamMembersByUser, null, 2), 'utf8');
    const totalMembers = Object.values(teamMembersByUser).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`💾 Saved team members for ${Object.keys(teamMembersByUser).length} users (${totalMembers} total members)`);
  } catch (error) {
    console.error('❌ Error saving team members:', error);
  }
}

// Helper to get team members for a user
function getUserTeamMembers(userEmail) {
  if (!userEmail) return [];
  return teamMembersByUser[userEmail.toLowerCase()] || [];
}

// Helper to set team members for a user
function setUserTeamMembers(userEmail, teamMembers) {
  if (!userEmail) return;
  teamMembersByUser[userEmail.toLowerCase()] = teamMembers;
  saveTeamMembers();
}

// Load team members on startup
loadTeamMembers();

// File-based user storage for authentication
const usersFile = path.join(__dirname, 'users.json');

// Load users from file
let users = [];
function loadUsers() {
  try {
    if (fs.existsSync(usersFile)) {
      const data = fs.readFileSync(usersFile, 'utf8');
      users = JSON.parse(data);
      console.log(`👥 Loaded ${users.length} users from file`);
    } else {
      users = [];
      console.log('👥 No users file found, starting with empty array');
    }
  } catch (error) {
    console.error('❌ Error loading users:', error);
    users = [];
  }
}

// Save users to file
function saveUsers() {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
    console.log(`💾 Saved ${users.length} users to file`);
  } catch (error) {
    console.error('❌ Error saving users:', error);
  }
}

// Hash password function
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Load users on startup
loadUsers();

// API Routes
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend HTTPS server is working!' });
});

// Reload users from file (useful for clearing cache)
app.post('/api/admin/reload-users', (req, res) => {
  loadUsers();
  res.json({ message: 'Users reloaded from file', count: users.length });
});

// Authentication Routes
// Signup endpoint
app.post('/api/auth/signup', (req, res) => {
  console.log('📥 POST /api/auth/signup - Request received');
  console.log('📥 Request body:', { email: req.body.email, password: req.body.password ? '***' : undefined });
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Check if user already exists
  const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return res.status(400).json({ error: 'User with this email already exists' });
  }
  
  // Validate password length
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }
  
  // Create new user
  const newUser = {
    id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
    email: email.toLowerCase(),
    password: hashPassword(password), // Hash password before storing
    createdAt: new Date().toISOString(),
    subscriptionStatus: 'pending' // New users need to complete payment
  };
  
  users.push(newUser);
  saveUsers();
  
  // Log user signup info
  logUserInfo('signup', email, {
    email: email,
    createdAt: newUser.createdAt
  });
  
  console.log(`✅ New user signed up: ${email}`);
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = newUser;
  res.status(201).json({ 
    user: userWithoutPassword,
    message: 'Account created successfully'
  });
});

// Login endpoint
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  // Find user by email
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  
  // Verify password
  const hashedPassword = hashPassword(password);
  if (user.password !== hashedPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  
  console.log(`✅ User logged in: ${email}`);
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  res.json({ 
    user: userWithoutPassword,
    message: 'Login successful'
  });
});

// Get current user endpoint (by email)
app.get('/api/auth/user', (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

// File-based user settings storage
const userSettingsFile = path.join(__dirname, 'userSettings.json');

// Load user settings from file
let userSettings = {};
function loadUserSettings() {
  try {
    if (fs.existsSync(userSettingsFile)) {
      const data = fs.readFileSync(userSettingsFile, 'utf8');
      userSettings = JSON.parse(data);
      console.log(`⚙️ Loaded settings for ${Object.keys(userSettings).length} users`);
    } else {
      userSettings = {};
      console.log('⚙️ No user settings file found, starting with empty object');
    }
  } catch (error) {
    console.error('❌ Error loading user settings:', error);
    userSettings = {};
  }
}

// Save user settings to file
function saveUserSettings() {
  try {
    fs.writeFileSync(userSettingsFile, JSON.stringify(userSettings, null, 2), 'utf8');
    console.log(`💾 Saved user settings to file`);
  } catch (error) {
    console.error('❌ Error saving user settings:', error);
  }
}

// Load user settings on startup
loadUserSettings();

// File-based user logs storage
const userLogsFile = path.join(__dirname, 'userLogs.json');

// Load user logs from file
let userLogs = [];
function loadUserLogs() {
  try {
    if (fs.existsSync(userLogsFile)) {
      const data = fs.readFileSync(userLogsFile, 'utf8');
      userLogs = JSON.parse(data);
      console.log(`📋 Loaded ${userLogs.length} user log entries`);
    } else {
      userLogs = [];
      console.log('📋 No user logs file found, starting with empty array');
    }
  } catch (error) {
    console.error('❌ Error loading user logs:', error);
    userLogs = [];
  }
}

// Save user logs to file
function saveUserLogs() {
  try {
    fs.writeFileSync(userLogsFile, JSON.stringify(userLogs, null, 2), 'utf8');
    console.log(`💾 Saved ${userLogs.length} user log entries to file`);
  } catch (error) {
    console.error('❌ Error saving user logs:', error);
  }
}

// Log user info function
function logUserInfo(type, email, userInfo) {
  const logEntry = {
    id: userLogs.length > 0 ? Math.max(...userLogs.map(l => l.id)) + 1 : 1,
    type: type, // 'signup' or 'settings'
    email: email.toLowerCase(),
    timestamp: new Date().toISOString(),
    userInfo: userInfo
  };
  
  userLogs.push(logEntry);
  saveUserLogs();
  console.log(`📋 Logged ${type} info for user: ${email}`);
}

// Load user logs on startup
loadUserLogs();

// Get user settings endpoint
app.get('/api/user/settings', (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  const settings = userSettings[email.toLowerCase()] || null;
  res.json(settings);
});

// Save user settings endpoint
app.post('/api/user/settings', (req, res) => {
  const { email, settings } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object is required' });
  }
  
  // Store settings by user email (lowercase)
  userSettings[email.toLowerCase()] = {
    ...settings,
    updatedAt: new Date().toISOString()
  };
  
  saveUserSettings();
  
  // Log user settings info (sanitize sensitive data)
  const sanitizedSettings = {
    cardholderName: settings.cardholderName || null,
    cardNumber: settings.cardNumber ? settings.cardNumber.replace(/\d(?=\d{4})/g, '*') : null, // Mask all but last 4 digits
    cardExpiry: settings.cardExpiry || null,
    cardCVC: settings.cardCVC ? '***' : null, // Never log CVC
    ownerName: settings.ownerName || null,
    managerName: settings.managerName || null,
    location: settings.location || null,
    accountEmail: settings.accountEmail || null,
    accountPassword: settings.accountPassword ? '***' : null, // Never log password
    updatedAt: new Date().toISOString()
  };
  
  logUserInfo('settings', email, sanitizedSettings);
  
  console.log(`✅ Saved settings for user: ${email}`);
  
  res.json({ 
    message: 'Settings saved successfully',
    settings: userSettings[email.toLowerCase()]
  });
});

// User logs API endpoint
app.get('/api/user-logs', (req, res) => {
  const { email, type, limit } = req.query;
  
  let filteredLogs = [...userLogs];
  
  // Filter by email if provided
  if (email) {
    filteredLogs = filteredLogs.filter(log => log.email.toLowerCase() === email.toLowerCase());
  }
  
  // Filter by type if provided
  if (type) {
    filteredLogs = filteredLogs.filter(log => log.type === type);
  }
  
  // Sort by timestamp, most recent first
  filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Limit results if provided
  if (limit) {
    filteredLogs = filteredLogs.slice(0, parseInt(limit));
  }
  
  res.json(filteredLogs);
});

// Get all users endpoint (without passwords)
app.get('/api/users', (req, res) => {
  const { email, limit } = req.query;
  
  // Return users without passwords
  let userList = users.map(user => {
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  });
  
  // Filter by email if provided
  if (email) {
    userList = userList.filter(user => user.email.toLowerCase().includes(email.toLowerCase()));
  }
  
  // Sort by creation date, most recent first
  userList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Limit results if provided
  if (limit) {
    userList = userList.slice(0, parseInt(limit));
  }
  
  res.json(userList);
});

// Delete user account endpoint
app.delete('/api/users/:id', (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Find user by ID
  const userIndex = users.findIndex(u => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const user = users[userIndex];
  const userEmail = user.email.toLowerCase();
  
  // Remove user from users array
  users.splice(userIndex, 1);
  saveUsers();
  
  // Remove user settings
  if (userSettings[userEmail]) {
    delete userSettings[userEmail];
    saveUserSettings();
  }
  
  // Remove user's products
  if (productsByUser[userEmail]) {
    delete productsByUser[userEmail];
    saveProducts();
  }
  
  // Remove user's categories
  if (categoriesByUser[userEmail]) {
    delete categoriesByUser[userEmail];
    saveCategories();
  }
  
  // Remove user's team members
  if (teamMembersByUser[userEmail]) {
    delete teamMembersByUser[userEmail];
    saveTeamMembers();
  }
  
  // Remove user logs (optional - you might want to keep logs for audit purposes)
  // Uncomment the following lines if you want to delete user logs as well:
  // userLogs = userLogs.filter(log => log.email.toLowerCase() !== userEmail);
  // saveUserLogs();
  
  console.log(`✅ Deleted user account: ${userEmail} (ID: ${userId})`);
  
  res.json({ 
    message: 'User account deleted successfully',
    deletedUser: {
      id: userId,
      email: user.email
    }
  });
});

// Get all products (user-specific - REQUIRED for security)
app.get('/api/products', (req, res) => {
  const { userEmail } = req.query;
  
  // Require userEmail for security - users should only see their own products
  if (!userEmail || !userEmail.trim()) {
    console.log('⚠️ GET /api/products - No userEmail provided, returning empty array');
    return res.json([]);
  }
  
  const userProducts = getUserProducts(userEmail);
  console.log(`📦 GET /api/products - Returning ${userProducts.length} products for user: ${userEmail}`);
  res.json(userProducts);
});

// Get single product (user-specific - REQUIRED for security)
app.get('/api/products/:id', (req, res) => {
  const { userEmail } = req.query;
  const productId = parseInt(req.params.id);
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    return res.status(400).json({ error: 'userEmail is required' });
  }
  
  const userProducts = getUserProducts(userEmail);
  const product = userProducts.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

// Update product (user-specific - REQUIRED for security)
app.put('/api/products/:id', upload.single('image'), async (req, res, next) => {
  console.log('📥 PUT /api/products/:id - Request received');
  console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📥 Content-Type:', req.headers['content-type']);
  
  const { userEmail } = req.body;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    return res.status(400).json({ error: 'userEmail is required' });
  }
  
  const productId = parseInt(req.params.id);
  const userProducts = getUserProducts(userEmail);
  const productIndex = userProducts.findIndex(p => p.id === productId);
  
  if (productIndex === -1) {
    console.error('❌ Product not found:', productId, 'for user:', userEmail);
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

  // Fix: Only declare product once, from userProducts, not products
  const product = userProducts[productIndex];

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
    
    // Process image with AI detection and cropping
    try {
      console.log('🤖 Processing image with AI detection and cropping...');
      const imagePath = req.file.path;
      await imageProcessor.processImageInPlace(imagePath);
      console.log('✅ AI image processing completed');
    } catch (error) {
      console.error('⚠️ AI image processing failed, using original image:', error.message);
      // Continue with original image if processing fails
    }
    
    // Set new image path
    product.image = `/uploads/${req.file.filename}`;
    console.log('✅ Image path set to:', product.image);
  } else {
    console.log('ℹ️ No image file in request');
  }

    userProducts[productIndex] = product;
    setUserProducts(userEmail, userProducts); // Persist to file
    
    console.log('✅ Product updated successfully:', {
      id: product.id,
      name: product.name,
      category: product.category,
      image: product.image,
      imageUrl: product.image ? `https://localhost:4001${product.image}` : null
    });
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

// Create product (user-specific - REQUIRED for security)
app.post('/api/products', upload.single('image'), async (req, res) => {
  const { name, price, description, category, toppings, ingredients, userEmail } = req.body;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    return res.status(400).json({ error: 'userEmail is required' });
  }
  
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

  // Process image with AI detection and cropping if uploaded
  if (req.file) {
    try {
      console.log('🤖 Processing new product image with AI detection and cropping...');
      const imagePath = req.file.path;
      await imageProcessor.processImageInPlace(imagePath);
      console.log('✅ AI image processing completed');
    } catch (error) {
      console.error('⚠️ AI image processing failed, using original image:', error.message);
      // Continue with original image if processing fails
    }
  }

  const userProducts = getUserProducts(userEmail);
  const newProduct = {
    id: userProducts.length > 0 ? Math.max(...userProducts.map(p => p.id)) + 1 : 1,
    name,
    price: parseFloat(price),
    description: description || '',
    category: category || 'Other',
    image: req.file ? `/uploads/${req.file.filename}` : null,
    toppings: parsedToppings,
    ingredients: parsedIngredients
  };

  userProducts.push(newProduct);
  setUserProducts(userEmail, userProducts); // Persist to file
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

// Delete product (user-specific - REQUIRED for security)
app.delete('/api/products/:id', (req, res) => {
  const { userEmail } = req.query;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    return res.status(400).json({ error: 'userEmail is required' });
  }
  
  const productId = parseInt(req.params.id);
  const userProducts = getUserProducts(userEmail);
  const productIndex = userProducts.findIndex(p => p.id === productId);
  
  if (productIndex === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = userProducts[productIndex];
  
  // Delete associated image if it exists
  if (product.image && product.image.startsWith('/uploads/')) {
    const imagePath = path.join(__dirname, product.image);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }

  userProducts.splice(productIndex, 1);
  setUserProducts(userEmail, userProducts); // Persist to file
  res.json({ message: 'Product deleted successfully' });
});

// Transaction Routes
// Get all transactions (filtered by userEmail - REQUIRED for security)
app.get('/api/transactions', (req, res) => {
  const { userEmail } = req.query;
  
  // Require userEmail for security - users should only see their own transactions
  if (!userEmail || !userEmail.trim()) {
    console.log('⚠️ GET /api/transactions - No userEmail provided, returning empty array');
    return res.json([]);
  }
  
  // Only return transactions that have a userEmail AND match the requested userEmail
  // This ensures old transactions without userEmail are never returned
  let filteredTransactions = transactions.filter(t => 
    t.userEmail && t.userEmail.toLowerCase() === userEmail.toLowerCase()
  );
  
  console.log(`💳 GET /api/transactions - Filtered by userEmail: ${userEmail}, Returning ${filteredTransactions.length} transactions`);
  
  // Sort by date, most recent first
  const sortedTransactions = filteredTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(sortedTransactions);
});

// Create a new transaction
app.post('/api/transactions', (req, res) => {
  console.log('💳 POST /api/transactions - Request received');
  console.log('💳 Request body:', JSON.stringify(req.body, null, 2));
  
  const { customerName, tableNumber, orderType, paymentMethod, items, subtotal, tax, total, timestamp, userEmail, stripePaymentIntentId } = req.body;
  
  // Validate required fields
  if (!customerName || !customerName.trim()) {
    console.error('❌ Validation error: customerName is required');
    return res.status(400).json({ error: 'Customer name is required' });
  }
  
  if (!paymentMethod) {
    console.error('❌ Validation error: paymentMethod is required');
    return res.status(400).json({ error: 'Payment method is required' });
  }
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    console.error('❌ Validation error: items array is required and must not be empty');
    return res.status(400).json({ error: 'Items array is required and must contain at least one item' });
  }
  
  if (!userEmail || !userEmail.trim()) {
    console.error('❌ Validation error: userEmail is required');
    return res.status(400).json({ error: 'User email is required' });
  }
  
  // Validate items structure
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.name) {
      console.error(`❌ Validation error: item at index ${i} is missing name`);
      return res.status(400).json({ error: `Item at index ${i} is missing required field: name` });
    }
    if (item.quantity === undefined || item.quantity === null) {
      console.error(`❌ Validation error: item at index ${i} is missing quantity`);
      return res.status(400).json({ error: `Item at index ${i} is missing required field: quantity` });
    }
    if (item.price === undefined && item.totalPrice === undefined) {
      console.error(`❌ Validation error: item at index ${i} is missing price`);
      return res.status(400).json({ error: `Item at index ${i} is missing required field: price or totalPrice` });
    }
  }

  try {
    const newTransaction = {
      id: transactions.length > 0 ? Math.max(...transactions.map(t => t.id)) + 1 : 1,
      customerName: customerName.trim(),
      tableNumber: orderType === 'Dine In' ? (tableNumber || null) : null,
      orderType: orderType || 'Takeout',
      paymentMethod,
      items: items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.totalPrice !== undefined ? item.totalPrice : item.price,
        selectedToppings: item.selectedToppings || []
      })),
      subtotal: parseFloat(subtotal) || 0,
      tax: parseFloat(tax) || 0,
      total: parseFloat(total) || 0,
      timestamp: timestamp || new Date().toISOString(), // Use provided timestamp or fallback to current time
      userEmail: userEmail.toLowerCase().trim(), // Store user email for filtering
      stripePaymentIntentId: stripePaymentIntentId || null // Store Stripe payment intent ID if available
    };

    transactions.push(newTransaction);
    saveTransactions(); // Persist to file
    console.log('💳 Created new transaction:', newTransaction.id);
    console.log('💳 Transaction details:', JSON.stringify(newTransaction, null, 2));
    res.status(201).json(newTransaction);
  } catch (error) {
    console.error('❌ Error creating transaction:', error);
    res.status(500).json({ error: 'Internal server error while creating transaction' });
  }
});

// Categories API Routes (user-specific)
app.get('/api/categories', (req, res) => {
  const { userEmail } = req.query;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    console.log('⚠️ GET /api/categories - No userEmail provided, returning default');
    return res.json(['All']);
  }
  
  const userCategories = getUserCategories(userEmail);
  console.log(`📁 GET /api/categories - Returning ${userCategories.length} categories for user: ${userEmail}`);
  res.json(userCategories);
});

app.post('/api/categories', (req, res) => {
  const { userEmail, categories } = req.body;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    return res.status(400).json({ error: 'userEmail is required' });
  }
  
  if (!categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: 'categories array is required' });
  }
  
  setUserCategories(userEmail, categories);
  console.log(`📁 POST /api/categories - Saved ${categories.length} categories for user: ${userEmail}`);
  res.json({ message: 'Categories saved successfully', categories });
});

// Team Members API Routes (user-specific)
app.get('/api/team-members', (req, res) => {
  const { userEmail } = req.query;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    console.log('⚠️ GET /api/team-members - No userEmail provided, returning empty array');
    return res.json([]);
  }
  
  const userTeamMembers = getUserTeamMembers(userEmail);
  console.log(`👥 GET /api/team-members - Returning ${userTeamMembers.length} team members for user: ${userEmail}`);
  res.json(userTeamMembers);
});

app.post('/api/team-members', (req, res) => {
  const { userEmail, teamMembers } = req.body;
  
  // Require userEmail for security
  if (!userEmail || !userEmail.trim()) {
    return res.status(400).json({ error: 'userEmail is required' });
  }
  
  if (!teamMembers || !Array.isArray(teamMembers)) {
    return res.status(400).json({ error: 'teamMembers array is required' });
  }
  
  setUserTeamMembers(userEmail, teamMembers);
  console.log(`👥 POST /api/team-members - Saved ${teamMembers.length} team members for user: ${userEmail}`);
  res.json({ message: 'Team members saved successfully', teamMembers });
});

// Menu analysis job storage (in-memory for now)
const menuAnalysisJobs = new Map();

// Menu analysis endpoint
app.post('/api/menu/analyze', menuUpload.single('menu'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store job status
    menuAnalysisJobs.set(jobId, {
      status: 'processing',
      filePath: req.file.path,
      fileName: req.file.filename,
      createdAt: new Date().toISOString()
    });

    // Start async analysis
    analyzeMenuFile(jobId, req.file.path, req.file.mimetype).catch(error => {
      console.error('❌ Menu analysis error:', error);
      menuAnalysisJobs.set(jobId, {
        status: 'failed',
        error: error.message,
        filePath: req.file.path,
        fileName: req.file.filename
      });
    });

    res.json({ jobId, status: 'processing' });
  } catch (error) {
    console.error('❌ Error uploading menu file:', error);
    res.status(500).json({ error: 'Failed to upload menu file' });
  }
});

// Menu analysis status endpoint
app.get('/api/menu/status/:jobId', (req, res) => {
  const job = menuAnalysisJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Stripe Terminal Routes
// Create connection token for Stripe Terminal
app.post('/api/stripe-terminal/connection-token', async (req, res) => {
  try {
    const connectionToken = await stripe.terminal.connectionTokens.create();
    res.json({ secret: connectionToken.secret });
  } catch (error) {
    console.error('❌ Error creating connection token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create PaymentIntent
app.post('/api/stripe-terminal/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }
    
    // Convert amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(amount * 100);
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency,
      payment_method_types: ['card_present'],
      capture_method: 'manual', // We'll capture manually after confirmation
      metadata: metadata
    });
    
    res.json({ 
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id
    });
  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Process payment on reader (for server-driven flow)
app.post('/api/stripe-terminal/process-payment', async (req, res) => {
  try {
    const { payment_intent_id, reader_id } = req.body;
    
    if (!payment_intent_id) {
      return res.status(400).json({ error: 'payment_intent_id is required' });
    }
    
    if (!reader_id) {
      return res.status(400).json({ error: 'reader_id is required' });
    }
    
    // Process the payment on the reader
    const paymentIntent = await stripe.terminal.readers.processPaymentIntent(
      reader_id,
      {
        payment_intent: payment_intent_id
      }
    );
    
    res.json({ 
      payment_intent: paymentIntent,
      status: paymentIntent.status
    });
  } catch (error) {
    console.error('❌ Error processing payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Capture PaymentIntent
app.post('/api/stripe-terminal/capture-payment', async (req, res) => {
  try {
    const { payment_intent_id } = req.body;
    
    if (!payment_intent_id) {
      return res.status(400).json({ error: 'payment_intent_id is required' });
    }
    
    const paymentIntent = await stripe.paymentIntents.capture(payment_intent_id);
    
    res.json({ 
      payment_intent: paymentIntent,
      status: paymentIntent.status
    });
  } catch (error) {
    console.error('❌ Error capturing payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get PaymentIntent status
app.get('/api/stripe-terminal/payment-intent/:id', async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(req.params.id);
    res.json({ 
      payment_intent: paymentIntent,
      status: paymentIntent.status
    });
  } catch (error) {
    console.error('❌ Error retrieving payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel PaymentIntent
app.post('/api/stripe-terminal/cancel-payment', async (req, res) => {
  try {
    const { payment_intent_id } = req.body;
    
    if (!payment_intent_id) {
      return res.status(400).json({ error: 'payment_intent_id is required' });
    }
    
    const paymentIntent = await stripe.paymentIntents.cancel(payment_intent_id);
    
    res.json({ 
      payment_intent: paymentIntent,
      status: paymentIntent.status
    });
  } catch (error) {
    console.error('❌ Error canceling payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze menu file with AI (OpenAI Vision API)
async function analyzeMenuFile(jobId, filePath, mimeType) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured. Please set it in your .env file.');
    }

    let OpenAI;
    try {
      OpenAI = require('openai');
    } catch (error) {
      throw new Error('OpenAI package not installed. Run: npm install openai');
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Read file and convert to base64
    const fileBuffer = fs.readFileSync(filePath);
    const base64Image = fileBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    // Use OpenAI Vision API to analyze the menu
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a menu analysis expert. Analyze the provided menu image/PDF and extract:
1. Menu sections/categories (e.g., "Appetizers", "Main Courses", "Desserts")
2. For each section, list all menu items with:
   - Item name
   - Price (extract numeric price, default to 0 if not found)
   - Available toppings/add-ons (if mentioned)
   - Ingredients (if listed)

Return the data in this exact JSON format:
{
  "sections": [
    {
      "name": "Section Name",
      "items": [
        {
          "name": "Item Name",
          "price": 12.99,
          "toppings": ["Topping 1", "Topping 2"],
          "ingredients": ["Ingredient 1", "Ingredient 2"]
        }
      ]
    }
  ]
}

Be thorough and extract all items. If prices aren't visible, use 0.00.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: dataUrl
              }
            },
            {
              type: 'text',
              text: 'Analyze this menu and extract all sections, items, prices, toppings, and ingredients. Return only valid JSON.'
            }
          ]
        }
      ],
      max_tokens: 4000
    });

    const content = response.choices[0].message.content;
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    const menuData = JSON.parse(jsonStr);

    // Update job status
    menuAnalysisJobs.set(jobId, {
      status: 'completed',
      result: menuData,
      filePath: filePath,
      fileName: path.basename(filePath)
    });

    console.log(`✅ Menu analysis completed for job ${jobId}`);
  } catch (error) {
    console.error('❌ Error analyzing menu:', error);
    menuAnalysisJobs.set(jobId, {
      status: 'failed',
      error: error.message,
      filePath: filePath
    });
    throw error;
  }
}

// Get Stripe publishable key
app.get('/api/subscription/publishable-key', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (!publishableKey) {
    return res.status(500).json({ error: 'Publishable key not configured' });
  }
  res.json({ publishableKey });
});

// Subscription endpoints
// Create Stripe Checkout Session for subscription with setup fee
app.post('/api/subscription/create-subscription', async (req, res) => {
  try {
    const { email, discountCode } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Find or create customer
    let customerId;
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (user && user.stripeCustomerId) {
      customerId = user.stripeCustomerId;
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: user ? user.id.toString() : 'new'
        }
      });
      
      customerId = customer.id;
      
      // Save customer ID to user
      if (user) {
        user.stripeCustomerId = customerId;
        saveUsers();
      }
    }
    
    // Get the frontend URL for success/cancel URLs
    // Use the origin from the request or default to localhost:3001 (current frontend port)
    const frontendUrl = req.headers.origin || 'https://localhost:3001';
    console.log('🔗 Frontend URL for checkout:', frontendUrl);
    console.log('🔗 Request origin:', req.headers.origin);
    
    // Create subscription price for monthly fee ($30.00/month)
    // In production, you should use existing price IDs from Stripe Dashboard
    let subscriptionPrice;
    try {
      subscriptionPrice = await stripe.prices.create({
        unit_amount: 3000, // $30.00 in cents
        currency: 'usd',
        recurring: {
          interval: 'month',
        },
        product_data: {
          name: 'Monthly Subscription',
        },
      });
      console.log('✅ Subscription price created:', subscriptionPrice.id);
    } catch (priceError) {
      console.error('Error creating subscription price:', priceError);
      throw new Error('Failed to create subscription price: ' + priceError.message);
    }
    
    // Create one-time price for setup fee ($99.00)
    let setupFeePrice;
    try {
      setupFeePrice = await stripe.prices.create({
        unit_amount: 9900, // $99.00 in cents
        currency: 'usd',
        product_data: {
          name: 'One-time Setup Fee',
        },
      });
      console.log('✅ Setup fee price created:', setupFeePrice.id);
    } catch (priceError) {
      console.error('Error creating setup fee price:', priceError);
      throw new Error('Failed to create setup fee price: ' + priceError.message);
    }
    
    // Create invoice item for setup fee that will be charged immediately with the subscription
    // This ensures both charges appear in the checkout and are processed together
    try {
      await stripe.invoiceItems.create({
        customer: customerId,
        amount: 9900, // $99.00 in cents
        currency: 'usd',
        description: 'One-time setup fee',
        metadata: {
          userEmail: email,
        },
      });
      console.log('✅ Setup fee invoice item created for customer:', customerId);
    } catch (invoiceItemError) {
      console.error('Error creating invoice item for setup fee:', invoiceItemError);
      // Continue - we'll still show the setup fee in checkout
    }
    
    // Create checkout session for subscription with setup fee
    // The setup fee invoice item will be included in the first invoice when subscription is created
    // This ensures both charges ($99 setup fee + $30/month subscription) are processed together
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          // Monthly subscription ($30/month)
          price: subscriptionPrice.id,
          quantity: 1,
        },
      ],
      // Apply discount code only if provided and valid
      ...(discountCode && discountCode.trim() ? {
        discounts: [{
          promotion_code: discountCode.trim()
        }]
      } : {}),
      // Custom description to show what's included
      custom_text: {
        submit: {
          message: 'You will be charged $99.00 setup fee + $30.00/month subscription',
        },
      },
      subscription_data: {
        metadata: {
          userEmail: email,
          setupFeeAmount: '9900', // Store setup fee amount
        },
        description: 'Monthly subscription with $99.00 one-time setup fee',
      },
      ui_mode: 'embedded',
      return_url: `${frontendUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        userEmail: email,
        planType: 'complete', // Both setup fee and subscription
        setupFeeAmount: '9900',
        subscriptionAmount: '3000',
      },
    });
    
    res.json({
      sessionId: session.id,
      clientSecret: session.client_secret
    });
  } catch (error) {
    console.error('❌ Error creating subscription:', error);
    console.error('❌ Error type:', error.type);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error raw:', error.raw);
    console.error('❌ Error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create subscription';
    let userFriendlyMessage = errorMessage;
    
    if (error.type === 'StripeInvalidRequestError') {
      if (error.code === 'resource_missing' && error.message.includes('promotion_code')) {
        errorMessage = 'Invalid discount code provided. Please check and try again.';
        userFriendlyMessage = errorMessage;
      } else if (error.code === 'account_invalid' || error.message?.toLowerCase().includes('account')) {
        errorMessage = 'Your Stripe account is currently under review. Payment processing is temporarily unavailable. Please check your Stripe Dashboard for account status.';
        userFriendlyMessage = 'Payment processing is temporarily unavailable. Your Stripe account is being reviewed. Please check your Stripe Dashboard or contact support.';
      } else if (error.code === 'parameter_invalid_empty' && error.message?.includes('payment')) {
        errorMessage = 'Payment processing is currently restricted. This may be due to account verification.';
        userFriendlyMessage = 'Payment processing is temporarily restricted. Please check your Stripe Dashboard for account status.';
      } else if (error.message) {
        errorMessage = `Stripe error: ${error.message}`;
        // Check for account review related keywords
        const reviewKeywords = ['review', 'restricted', 'verification', 'under review', 'activation'];
        if (reviewKeywords.some(keyword => error.message.toLowerCase().includes(keyword))) {
          userFriendlyMessage = 'Your Stripe account may be under review. Payment processing is temporarily unavailable. Please check your Stripe Dashboard.';
        } else {
          userFriendlyMessage = errorMessage;
        }
      }
    } else if (error.code === 'account_invalid' || error.type === 'StripeAPIError') {
      errorMessage = 'Stripe account issue detected. Please check your Stripe Dashboard for account status.';
      userFriendlyMessage = 'Payment processing is temporarily unavailable. Your Stripe account may be under review. Please check your Stripe Dashboard.';
    } else if (error.message) {
      errorMessage = error.message;
      userFriendlyMessage = errorMessage;
    }
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ 
      error: userFriendlyMessage,
      technicalError: errorMessage,
      type: error.type,
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update subscription status after successful payment
app.post('/api/subscription/update-status', (req, res) => {
  const { email, subscriptionStatus } = req.body;
  
  if (!email || !subscriptionStatus) {
    return res.status(400).json({ error: 'Email and subscription status are required' });
  }
  
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  user.subscriptionStatus = subscriptionStatus;
  saveUsers();
  
  console.log(`✅ Subscription status updated for ${email}: ${subscriptionStatus}`);
  
  const { password: _, ...userWithoutPassword } = user;
  res.json({ 
    user: userWithoutPassword,
    message: 'Subscription status updated successfully'
  });
});

// Verify Stripe checkout session
app.get('/api/subscription/verify-session', async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    // Handle subscription with setup fee
    if (session.payment_status === 'paid' && session.mode === 'subscription') {
      const userEmail = session.metadata?.userEmail || session.customer_email;
      
      if (userEmail) {
        const user = users.find(u => u.email.toLowerCase() === userEmail.toLowerCase());
        if (user) {
          // Update customer ID and subscription info
          user.stripeCustomerId = session.customer;
          user.stripeSubscriptionId = session.subscription;
          user.subscriptionStatus = 'active';
          user.setupFeePaid = true; // Setup fee was paid as part of the subscription
          
          saveUsers();
        }
      }
      
      res.json({ 
        success: true, 
        paymentStatus: session.payment_status,
        customerEmail: userEmail,
        mode: session.mode,
        planType: 'complete' // Both setup fee and subscription completed
      });
    } else {
      res.json({ 
        success: false, 
        paymentStatus: session.payment_status 
      });
    }
  } catch (error) {
    console.error('Error verifying session:', error);
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

// Server startup - Use HTTP in production (Railway handles HTTPS), HTTPS in development
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Production: Use HTTP (Railway handles TLS termination)
  http.createServer(app).listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend HTTP server running on port ${PORT}`);
    console.log(`📝 Health check: /api/health`);
    console.log(`🔐 Auth endpoints:`);
    console.log(`   POST /api/auth/signup`);
    console.log(`   POST /api/auth/login`);
    console.log(`   GET  /api/auth/user`);
    console.log(`⚙️  Settings endpoints:`);
    console.log(`   GET  /api/user/settings`);
    console.log(`   POST /api/user/settings`);
    console.log(`👥 User Management:`);
    console.log(`   GET  /api/users`);
    console.log(`   🌐 /users (Web Interface)`);
    console.log(`📋 Activity Logs:`);
    console.log(`   GET  /api/user-logs`);
    console.log(`   🌐 /logs (Web Interface)`);
    console.log(`💳 Stripe Terminal endpoints:`);
    console.log(`   POST /api/stripe-terminal/connection-token`);
    console.log(`   POST /api/stripe-terminal/create-payment-intent`);
    console.log(`   POST /api/stripe-terminal/process-payment`);
    console.log(`   POST /api/stripe-terminal/capture-payment`);
    console.log(`   GET  /api/stripe-terminal/payment-intent/:id`);
    console.log(`   POST /api/stripe-terminal/cancel-payment`);
    console.log(`💳 Subscription endpoints:`);
    console.log(`   GET  /api/subscription/publishable-key`);
    console.log(`   POST /api/subscription/create-subscription`);
    console.log(`   POST /api/subscription/confirm-payment`);
    console.log(`   POST /api/subscription/update-status`);
  });
} else {
  // Development: Use HTTPS with SSL certificates
  try {
    const sslOptions = {
      key: fs.readFileSync(path.join(__dirname, '../ssl/server.key')),
      cert: fs.readFileSync(path.join(__dirname, '../ssl/server.crt'))
    };
    
    https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Backend HTTPS server running on https://localhost:${PORT}`);
      console.log(`📝 Health check: https://localhost:${PORT}/api/health`);
      console.log(`🔐 Auth endpoints:`);
      console.log(`   POST https://localhost:${PORT}/api/auth/signup`);
      console.log(`   POST https://localhost:${PORT}/api/auth/login`);
      console.log(`   GET  https://localhost:${PORT}/api/auth/user`);
      console.log(`⚙️  Settings endpoints:`);
      console.log(`   GET  https://localhost:${PORT}/api/user/settings`);
      console.log(`   POST https://localhost:${PORT}/api/user/settings`);
      console.log(`👥 User Management:`);
      console.log(`   GET  https://localhost:${PORT}/api/users`);
      console.log(`   🌐 https://localhost:${PORT}/users (Web Interface)`);
      console.log(`📋 Activity Logs:`);
      console.log(`   GET  https://localhost:${PORT}/api/user-logs`);
      console.log(`   🌐 https://localhost:${PORT}/logs (Web Interface)`);
      console.log(`💳 Stripe Terminal endpoints:`);
      console.log(`   POST https://localhost:${PORT}/api/stripe-terminal/connection-token`);
      console.log(`   POST https://localhost:${PORT}/api/stripe-terminal/create-payment-intent`);
      console.log(`   POST https://localhost:${PORT}/api/stripe-terminal/process-payment`);
      console.log(`   POST https://localhost:${PORT}/api/stripe-terminal/capture-payment`);
      console.log(`   GET  https://localhost:${PORT}/api/stripe-terminal/payment-intent/:id`);
      console.log(`   POST https://localhost:${PORT}/api/stripe-terminal/cancel-payment`);
      console.log(`💳 Subscription endpoints:`);
      console.log(`   GET  https://localhost:${PORT}/api/subscription/publishable-key`);
      console.log(`   POST https://localhost:${PORT}/api/subscription/create-subscription`);
      console.log(`   POST https://localhost:${PORT}/api/subscription/confirm-payment`);
      console.log(`   POST https://localhost:${PORT}/api/subscription/update-status`);
    });
  } catch (error) {
    console.error('❌ Error loading SSL certificates:', error.message);
    console.log('⚠️  Falling back to HTTP server...');
    http.createServer(app).listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Backend HTTP server running on http://localhost:${PORT} (SSL not available)`);
    });
  }
}


