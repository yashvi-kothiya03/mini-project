const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const User = require('./models/User');
const Product = require('./models/Product');
const Cart = require('./models/Cart');
const Order = require('./models/Order');

const app = express();
const JWT_SECRET = 'your-secret-key-change-in-production';

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`📁 Created uploads directory: ${uploadsDir}`);
}

// Middleware
app.use(express.json());
app.use(cors());

// Static files for uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/patanjali';

// Mongoose connection with retry logic (keeps server running in dev if DB is down)
const connectWithRetry = async (retries = 10, delay = 5000) => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB Connected Successfully!');
    console.log('Database:', MONGODB_URI);
    // Ensure default users exist (create or reset to known credentials)
    const ensureDefaultUsers = async () => {
      try {
        const defaults = [
          { name: 'Admin User', email: 'admin@gmail.com', password: 'admin123', role: 'admin' },
          { name: 'Client User', email: 'clint@gmail.com', password: 'clint123', role: 'client' }
        ];

        for (const def of defaults) {
          // Force delete and recreate to ensure password is properly hashed
          await User.deleteOne({ email: def.email });
          const user = new User({ name: def.name, email: def.email, password: def.password, role: def.role });
          await user.save();
          console.log(`✅ Default user ensured (recreated): ${def.email} with role: ${def.role}`);
        }
        console.log('✅ Default users are ready.');
      } catch (err) {
        console.error('❌ Error ensuring default users:', err.message);
      }
    };

    ensureDefaultUsers();
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    if (retries > 0) {
      console.log(`Retrying to connect in ${delay / 1000}s... (${retries} retries left)`);
      setTimeout(() => connectWithRetry(retries - 1, delay), delay);
    } else {
      console.error('Exceeded connection retries. Server will keep running, but DB is not connected.');
    }
  }
};

// Helpful connection event logs
mongoose.connection.on('connected', () => console.log('Mongoose: connected to DB'));
mongoose.connection.on('disconnected', () => console.warn('Mongoose: disconnected from DB'));
mongoose.connection.on('error', (err) => console.error('Mongoose connection error:', err));

// Start initial connect attempt
connectWithRetry();

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ===== AUTH ROUTES =====

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide all fields' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create user
    const user = new User({ name, email, password, role });
    await user.save();

    // Generate token
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    // Find user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      console.log(`❌ Login failed: User not found for email ${email}`);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log(`🔐 Attempting login for ${email}, password field exists: ${!!user.password}`);

    // Check password
    const isPasswordCorrect = await user.matchPassword(password);
    console.log(`🔐 Password check result: ${isPasswordCorrect} for ${email}`);
    if (!isPasswordCorrect) {
      console.log(`❌ Login failed: Invalid password for ${email}`);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== PRODUCT ROUTES =====

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create product (Admin only)
app.post('/api/products', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Only admin can add products' });
    }

    const { name, description, price, quantity, category } = req.body;

    // Validation
    if (!name || !description || !price || !quantity || !category) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an image' });
    }

    // Image URL path
    const imageUrl = `/uploads/${req.file.filename}`;

    const product = new Product({ name, description, price, quantity, category, image: imageUrl });
    await product.save();

    res.status(201).json({ message: 'Product created successfully', product });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update product (Admin only)
app.put('/api/products/:id', verifyToken, upload.single('image'), async (req, res) => {
  try {
    // Check if user is admin
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Only admin can update products. Your role: ' + req.userRole });
    }

    const { name, description, price, quantity, category } = req.body;
    const updateData = { name, description, price, quantity, category };

    console.log(`📝 Updating product ${req.params.id}:`, { name, description, price, quantity, category, hasFile: !!req.file });

    // If new image uploaded, add it to update
    if (req.file) {
      updateData.image = `/uploads/${req.file.filename}`;
      console.log(`📸 New image uploaded: ${updateData.image}`);
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!product) {
      console.error(`❌ Product not found: ${req.params.id}`);
      return res.status(404).json({ message: 'Product not found' });
    }

    console.log(`✅ Product updated successfully: ${req.params.id}`);
    res.status(200).json({ message: 'Product updated successfully', product });
  } catch (error) {
    console.error(`❌ Update error: ${error.message}`);
    res.status(500).json({ message: error.message });
  }
});

// Delete product (Admin only)
app.delete('/api/products/:id', verifyToken, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Only admin can delete products' });
    }

    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== CART ROUTES =====

// Get cart
app.get('/api/cart', verifyToken, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.userId }).populate('items.productId');
    if (!cart) return res.status(404).json({ message: 'Cart not found' });
    res.status(200).json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add to cart
app.post('/api/cart/add', verifyToken, async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity) {
      return res.status(400).json({ message: 'Please provide productId and quantity' });
    }

    // Get product
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Find or create cart
    let cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      cart = new Cart({ userId: req.userId, items: [] });
    }

    // Check if product already in cart
    const existingItem = cart.items.find(item => item.productId.toString() === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ productId, quantity, price: product.price });
    }

    // Calculate total
    cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    await cart.save();

    res.status(200).json({ message: 'Item added to cart', cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Remove from cart
app.post('/api/cart/remove', verifyToken, async (req, res) => {
  try {
    const { productId } = req.body;

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    cart.items = cart.items.filter(item => item.productId.toString() !== productId);
    cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    await cart.save();

    res.status(200).json({ message: 'Item removed from cart', cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update cart item quantity
app.post('/api/cart/update', verifyToken, async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    const item = cart.items.find(item => item.productId.toString() === productId);
    if (!item) return res.status(404).json({ message: 'Item not found in cart' });

    item.quantity = quantity;
    cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    await cart.save();

    res.status(200).json({ message: 'Cart updated', cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== ORDER ROUTES =====

// Create order (from cart)
app.post('/api/orders', verifyToken, async (req, res) => {
  try {
    const { shippingAddress, paymentMethod } = req.body;

    if (!shippingAddress || !paymentMethod) {
      return res.status(400).json({ message: 'Please provide shipping address and payment method' });
    }

    // Get user's cart
    const cart = await Cart.findOne({ userId: req.userId }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    // Create order
    const order = new Order({
      userId: req.userId,
      items: cart.items.map(item => ({
        productId: item.productId._id,
        productName: item.productId.name,
        quantity: item.quantity,
        price: item.price
      })),
      totalPrice: cart.totalPrice,
      shippingAddress,
      paymentMethod
    });

    await order.save();

    // Clear cart
    await Cart.deleteOne({ userId: req.userId });

    res.status(201).json({ message: 'Order placed successfully', order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's orders
app.get('/api/orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.userId }).populate('items.productId');
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single order
app.get('/api/orders/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('items.productId');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update order status (Admin only)
app.put('/api/orders/:id/status', verifyToken, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Only admin can update order status' });
    }

    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    res.status(200).json({ message: 'Order status updated', order });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete/Cancel order (User can only cancel their own pending orders)
app.delete('/api/orders/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user owns this order
    if (order.userId.toString() !== req.userId) {
      return res.status(403).json({ message: 'You can only cancel your own orders' });
    }

    // Check if order can be cancelled (only pending orders)
    if (order.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending orders can be cancelled' });
    }

    // Delete the order
    await User.findByIdAndDelete(req.params.id);

res.status(200).json({ message: 'User deleted successfully' });

} catch (error) {
  res.status(500).json({ message: error.message });
}
});

// Get all orders (Admin only)
app.get('/api/admin/orders', verifyToken, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view all orders' });
    }

    const orders = await Order.find().populate('userId').populate('items.productId');
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== USER ROUTES =====

// Get all users (Admin only)
app.get('/api/admin/users', verifyToken, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view users' });
    }

    const users = await User.find().select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete user (Admin only)
app.delete('/api/admin/users/:id', verifyToken, async (req, res) => {
  try {
    return res.status(403).json({
      message: 'User deletion is completely disabled'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// app.delete('/api/admin/users/:id', verifyToken, async (req, res) => {
//   try {
//     // Sirf admin access kare
//     if (req.userRole !== 'admin') {
//       return res.status(403).json({ message: 'Only admin can access this' });
//     }

//     const userToDelete = await User.findById(req.params.id);
//     if (!userToDelete) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     // ❌ ADMIN delete nahi hoga
//     if (userToDelete.role === 'admin') {
//       return res.status(403).json({ message: 'Admin cannot be deleted' });
//     }

//     // ❌ CLIENT delete nahi hoga
//     if (userToDelete.role === 'client') {
//       return res.status(403).json({ message: 'Client cannot be deleted' });
//     }

//     // ❌ extra safety (koi bhi user delete na ho)
//     return res.status(403).json({ message: 'User deletion is disabled' });

//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });
// ===== SEED DATA ROUTE =====
app.get('/api/seed', async (req, res) => {
  try {
    // Clear existing data
    await User.deleteMany({});
    await Product.deleteMany({});

    // Create test users
    const users = await User.create([
      {
        name: 'Client User',
        email: 'clint@gmail.com',
        password: 'clint123',
        role: 'client'
      },
      {
        name: 'Admin User',
        email: 'admin@gmail.com',
        password: 'admin123',
        role: 'admin'
      }
    ]);

    // Create test products
    const uploadedImages = fs.readdirSync(uploadsDir).filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));

    const productsData = [
      {
        name: 'Organic Wheat Flour',
        description: 'Premium quality organic wheat flour for healthy cooking. 100% natural and processed without chemicals.',
        price: 249,
        quantity: 100,
        category: 'Flour & Grains',
        image: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&h=400&fit=crop'
      },
      {
        name: 'Honey - Pure & Raw',
        description: 'Pure, unfiltered raw honey collected from natural beehives. Rich in antioxidants and enzymes.',
        price: 399,
        quantity: 50,
        category: 'Sweeteners',
        image: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=400&h=400&fit=crop'
      },
      {
        name: 'Turmeric Powder',
        description: 'High-quality turmeric powder with curcumin. Excellent for health and cooking.',
        price: 89,
        quantity: 200,
        category: 'Spices',
        image: 'https://images.unsplash.com/photo-1618375569909-3c8616cf09ae?w=400&h=400&fit=crop'
      },
      {
        name: 'Ashwagandha Powder',
        description: 'Authentic Ashwagandha powder for immunity and stress relief. Lab tested and certified.',
        price: 459,
        quantity: 30,
        category: 'Herbs',
        image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&h=400&fit=crop'
      },
      {
        name: 'Sesame Oil - Cold Pressed',
        description: 'Cold-pressed sesame oil for cooking and massage. Rich, aromatic flavor.',
        price: 349,
        quantity: 45,
        category: 'Oils',
        image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=400&fit=crop'
      },
      {
        name: 'Chyawanprash',
        description: 'Traditional Ayurvedic formulation for energy and vitality. Made with 40+ herbs.',
        price: 289,
        quantity: 60,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1550572017-edd951aa8ca9?w=400&h=400&fit=crop'
      },
      {
        name: 'Neem Leaves Powder',
        description: 'Pure neem powder for skin health and immunity. Natural detoxifier.',
        price: 159,
        quantity: 80,
        category: 'Herbs',
        image: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&h=400&fit=crop'
      },
      {
        name: 'Organic Green Tea',
        description: 'Pure organic green tea leaves. Antioxidant rich and refreshing.',
        price: 199,
        quantity: 70,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Aloe Vera Gel',
        description: 'Pure aloe vera gel for skin care. Soothes and moisturizes naturally.',
        price: 129,
        quantity: 90,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=400&fit=crop'
      },
      {
        name: 'Coconut Oil - Virgin',
        description: 'Extra virgin coconut oil for cooking, hair care, and skin. 100% pure.',
        price: 299,
        quantity: 55,
        category: 'Oils',
        image: 'https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?w=400&h=400&fit=crop'
      },
      {
        name: 'Ghee - Pure Cow',
        description: 'Pure desi cow ghee made from organic milk. Rich in vitamins and healthy fats.',
        price: 499,
        quantity: 40,
        category: 'Dairy',
        image: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=400&h=400&fit=crop'
      },
      {
        name: 'Triphala Powder',
        description: 'Ancient Ayurvedic formula for digestion and detoxification. Three fruits blend.',
        price: 189,
        quantity: 65,
        category: 'Herbs',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Shilajit Resin',
        description: 'Pure Himalayan Shilajit resin for energy and vitality. Natural mineral supplement.',
        price: 899,
        quantity: 25,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=400&h=400&fit=crop'
      },
      {
        name: 'Mustard Oil - Kachi Ghani',
        description: 'Traditional kachi ghani mustard oil. Rich in omega-3 and antioxidants.',
        price: 179,
        quantity: 75,
        category: 'Oils',
        image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=400&fit=crop'
      },
      {
        name: 'Basmati Rice - Organic',
        description: 'Premium organic basmati rice. Long grains, aromatic, and nutritious.',
        price: 349,
        quantity: 85,
        category: 'Flour & Grains',
        image: 'https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=400&h=400&fit=crop'
      },
      {
        name: 'Amla Juice',
        description: 'Pure amla juice for immunity and hair health. Rich in Vitamin C.',
        price: 149,
        quantity: 95,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1571771019784-3ff35f4f4277?w=400&h=400&fit=crop'
      },
      {
        name: 'Cow Urine Ark',
        description: 'Distilled cow urine for health and wellness. Traditional Ayurvedic remedy.',
        price: 229,
        quantity: 50,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop'
      },
      {
        name: 'Multani Mitti Face Pack',
        description: 'Natural multani mitti face pack for glowing skin. Removes impurities.',
        price: 99,
        quantity: 110,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Karela Jam',
        description: 'Bitter gourd jam for blood sugar control. Natural and healthy.',
        price: 189,
        quantity: 60,
        category: 'Food',
        image: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=400&h=400&fit=crop'
      },
      {
        name: 'Giloy Juice',
        description: 'Pure giloy stem juice for immunity boost. Natural antibiotic properties.',
        price: 169,
        quantity: 70,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1571771019784-3ff35f4f4277?w=400&h=400&fit=crop'
      },
      {
        name: 'Dant Kanti Toothpaste',
        description: 'Natural toothpaste with pomegranate and triphala. Fluoride-free.',
        price: 89,
        quantity: 120,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1559599101-f09722fb4948?w=400&h=400&fit=crop'
      },
      {
        name: 'Pea Protein Powder',
        description: 'Plant-based protein powder for fitness. High protein, low carb.',
        price: 599,
        quantity: 35,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop'
      },
      {
        name: 'Organic Jaggery',
        description: 'Pure organic jaggery from sugarcane. Natural sweetener with minerals.',
        price: 129,
        quantity: 80,
        category: 'Sweeteners',
        image: 'https://images.unsplash.com/photo-1541599468348-e96984315621?w=400&h=400&fit=crop'
      },
      {
        name: 'Saundarya Face Wash',
        description: 'Herbal face wash with aloe vera and neem. Gentle cleansing.',
        price: 119,
        quantity: 100,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Saundarya Neem Tulsi Face Wash',
        description: 'Face wash with neem and tulsi to cleanse and refresh skin, perfect for daily use.',
        price: 129,
        quantity: 90,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1611095973512-78e8f7cd7d42?w=400&h=400&fit=crop'
      },
      {
        name: 'Divya Medohar Vati',
        description: 'Ayurvedic medicine for weight management. Natural fat burner.',
        price: 349,
        quantity: 45,
        category: 'Ayurvedic Medicine',
        image: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=400&h=400&fit=crop'
      },
      {
        name: 'Badam Pak',
        description: 'Almond-based sweet for brain health. Made with almonds and ghee.',
        price: 279,
        quantity: 55,
        category: 'Food',
        image: 'https://images.unsplash.com/photo-1606312619070-d48b4c652a52?w=400&h=400&fit=crop'
      },
      {
        name: 'Herbal Mehandi',
        description: 'Natural henna powder for hair and skin. Enriched with herbs for shine.',
        price: 149,
        quantity: 60,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=400&h=400&fit=crop'
      },
      {
        name: 'Saundarya Face Scrub (Multani Mitti)',
        description: 'Deep-cleanse face scrub with multani mitti for glowing skin.',
        price: 119,
        quantity: 80,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1567371382973-f1f9730791b4?w=400&h=400&fit=crop'
      },
      {
        name: 'Neem Kanti Body Cleanser',
        description: 'Neem-based body cleanser for clear and refreshed skin.',
        price: 129,
        quantity: 70,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Amla Pickle',
        description: 'Tangy amla pickle for digestion and immunity support.',
        price: 89,
        quantity: 90,
        category: 'Food',
        image: 'https://images.unsplash.com/photo-1598257005620-f82e2c5c9c6d?w=400&h=400&fit=crop'
      },
      {
        name: 'Giloy Ghanvati',
        description: 'Herbal ayurvedic tablets for immunity and detoxification.',
        price: 199,
        quantity: 75,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1543168255-7571d868d9d4?w=400&h=400&fit=crop'
      },
      {
        name: 'Arogya Vati',
        description: 'Ayurvedic tablets to support overall health and digestion.',
        price: 179,
        quantity: 80,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1580652489518-a1c6126b53a2?w=400&h=400&fit=crop'
      },
      {
        name: 'Bel Candy',
        description: 'Sweet bel candy for oral health and energy.',
        price: 49,
        quantity: 120,
        category: 'Food',
        image: 'https://images.unsplash.com/photo-1528825871115-3581a5387919?w=400&h=400&fit=crop'
      },
      {
        name: 'Super Scrub (Steel)',
        description: 'Heavy-duty scrubber for kitchen cleaning and rust removal.',
        price: 59,
        quantity: 150,
        category: 'Household',
        image: 'https://images.unsplash.com/photo-1584780578892-17112e6a4905?w=400&h=400&fit=crop'
      },
      {
        name: 'Mixed Fruit Juice',
        description: 'Refreshing mixed fruit beverage, high in vitamin C.',
        price: 89,
        quantity: 100,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1532634896-26909d0dca58?w=400&h=400&fit=crop'
      },
      {
        name: 'Sandal Soap',
        description: 'Fragrant sandalwood soap for healthy, glowing skin.',
        price: 69,
        quantity: 110,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1599601874108-d5c4a6bda145?w=400&h=400&fit=crop'
      },
      {
        name: 'Aloe Vera Kanti Soap',
        description: 'Soothing aloe vera soap for gentle cleansing and moisturized skin.',
        price: 79,
        quantity: 95,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Turmeric Face Pack',
        description: 'Natural turmeric face pack for glowing and acne-free skin.',
        price: 149,
        quantity: 85,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Neem Face Wash',
        description: 'Pure neem face wash for clear and healthy skin.',
        price: 119,
        quantity: 100,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Honey Face Mask',
        description: 'Natural honey face mask for moisturizing and rejuvenating skin.',
        price: 199,
        quantity: 70,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=400&h=400&fit=crop'
      },
      {
        name: 'Amla Hair Oil',
        description: 'Amla-based hair oil for strong and healthy hair growth.',
        price: 249,
        quantity: 60,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Brahmi Oil',
        description: 'Brahmi oil for mental clarity and healthy scalp.',
        price: 299,
        quantity: 45,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Rose Water',
        description: 'Pure rose water for skin toning and refreshing.',
        price: 99,
        quantity: 120,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1571771019784-3ff35f4f4277?w=400&h=400&fit=crop'
      },
      {
        name: 'Sandalwood Powder',
        description: 'Pure sandalwood powder for face packs and worship.',
        price: 179,
        quantity: 80,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Kumkumadi Oil',
        description: 'Ayurvedic kumkumadi oil for skin brightening and anti-aging.',
        price: 499,
        quantity: 35,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Panchagavya Soap',
        description: 'Traditional panchagavya soap for natural cleansing.',
        price: 89,
        quantity: 90,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop'
      },
      {
        name: 'Herbal Shampoo',
        description: 'Natural herbal shampoo for healthy and shiny hair.',
        price: 159,
        quantity: 110,
        category: 'Personal Care',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Tea Tree Oil',
        description: 'Pure tea tree oil for skin care and aromatherapy.',
        price: 349,
        quantity: 50,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Lavender Essential Oil',
        description: 'Calming lavender essential oil for relaxation and sleep.',
        price: 399,
        quantity: 40,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Eucalyptus Oil',
        description: 'Refreshing eucalyptus oil for respiratory health.',
        price: 279,
        quantity: 55,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Peppermint Oil',
        description: 'Cooling peppermint oil for digestion and headaches.',
        price: 229,
        quantity: 65,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Lemon Grass Oil',
        description: 'Aromatic lemon grass oil for relaxation and insect repellent.',
        price: 189,
        quantity: 70,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Jasmine Essential Oil',
        description: 'Romantic jasmine oil for mood enhancement and skin care.',
        price: 459,
        quantity: 35,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Frankincense Oil',
        description: 'Sacred frankincense oil for meditation and spiritual practices.',
        price: 599,
        quantity: 25,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Patchouli Oil',
        description: 'Earthy patchouli oil for grounding and skin care.',
        price: 329,
        quantity: 45,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Ylang Ylang Oil',
        description: 'Sweet ylang ylang oil for stress relief and hair care.',
        price: 379,
        quantity: 40,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=400&fit=crop'
      },
      {
        name: 'Orange Essential Oil',
        description: 'Uplifting orange oil for energy and cleaning.',
        price: 249,
        quantity: 55,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1532634896-26909d0dca58?w=400&h=400&fit=crop'
      },
      {
        name: 'Bergamot Oil',
        description: 'Citrus bergamot oil for mood balancing and skin care.',
        price: 419,
        quantity: 38,
        category: 'Wellness',
        image: 'https://images.unsplash.com/photo-1532634896-26909d0dca58?w=400&h=400&fit=crop'
      },
      {
        name: 'Chamomile Tea',
        description: 'Calming chamomile tea for relaxation and sleep.',
        price: 149,
        quantity: 85,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Green Tea Bags',
        description: 'Premium green tea bags for antioxidants and health.',
        price: 179,
        quantity: 100,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Tulsi Tea',
        description: 'Holy basil tea for immunity and stress relief.',
        price: 159,
        quantity: 90,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Ginger Tea',
        description: 'Spicy ginger tea for digestion and warmth.',
        price: 139,
        quantity: 95,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Turmeric Latte Mix',
        description: 'Golden milk mix with turmeric and spices for health.',
        price: 299,
        quantity: 60,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Ashwagandha Tea',
        description: 'Adaptogenic ashwagandha tea for stress management.',
        price: 199,
        quantity: 75,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Moringa Tea',
        description: 'Nutrient-rich moringa tea for overall wellness.',
        price: 169,
        quantity: 80,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Neem Tea',
        description: 'Bitter neem tea for detoxification and immunity.',
        price: 149,
        quantity: 85,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Hibiscus Tea',
        description: 'Vibrant hibiscus tea for heart health and antioxidants.',
        price: 159,
        quantity: 88,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Lemongrass Tea',
        description: 'Refreshing lemongrass tea for digestion and relaxation.',
        price: 139,
        quantity: 92,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Cardamom Tea',
        description: 'Aromatic cardamom tea for digestion and flavor.',
        price: 169,
        quantity: 78,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Fennel Tea',
        description: 'Digestive fennel tea for bloating and gas relief.',
        price: 149,
        quantity: 82,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      },
      {
        name: 'Rosehip Tea',
        description: 'Vitamin C rich rosehip tea for immunity.',
        price: 189,
        quantity: 70,
        category: 'Beverages',
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=400&fit=crop'
      }
    ];

    const productsToCreate = productsData.map((product, index) => ({
      ...product,
      image: uploadedImages[index] ? `/uploads/${uploadedImages[index]}` : product.image
    }));

    const products = await Product.create(productsToCreate);

    res.status(201).json({
      message: 'Test data created successfully!',
      users: [
        {
          name: 'John Client',
          email: 'client@test.com',
          password: 'password123',
          role: 'CLIENT',
          note: 'Use this to login as a regular customer'
        },
        {
          name: 'Admin User',
          email: 'admin@test.com',
          password: 'admin123',
          role: 'ADMIN',
          note: 'Use this to access admin dashboard'
        }
      ],
      productsCount: products.length,
      note: 'Test data has been seeded. You can now login with the credentials above.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Debug: List all users
app.get('/api/debug/users', async (req, res) => {
  try {
    const users = await User.find({});
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Test route
app.get('/', (req, res) => {
  res.send('Patanjali Backend Running - E-commerce API. Visit /api/seed to create test data.');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
