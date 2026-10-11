import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDatabase } from './database.js';
import { createRepositories } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function seedDatabase(options = {}) {
  console.log('[Seed] Starting unified database seeding...');
  const repos = createRepositories(options.dbInstance);

  // 1. Seed Notification Templates (Section 14)
  const templates = [
    {
      id: 'order_placed',
      eventType: 'order.created',
      channel: 'WHATSAPP',
      title: 'Order Placed Confirmation',
      templateText: '🎉 Hello {{customer_name}}, thank you for shopping with us! Your order *#{{order_id}}* for *₹{{amount}}* has been placed successfully. Payment Method: *{{payment_method}}*. We are processing it right away!'
    },
    {
      id: 'payment_success',
      eventType: 'payment.success',
      channel: 'WHATSAPP',
      title: 'Payment Successful',
      templateText: '✅ Payment Received! Dear {{customer_name}}, your payment of *₹{{amount}}* for Order *#{{order_id}}* (Txn: {{transaction_id}}) has been verified successfully via {{payment_method}}. Your items are now being prepared.'
    },
    {
      id: 'payment_failed',
      eventType: 'payment.failed',
      channel: 'WHATSAPP',
      title: 'Payment Failed Alert',
      templateText: '⚠️ Payment Notice: Hello {{customer_name}}, the payment attempt for Order *#{{order_id}}* could not be completed. Reason: {{failure_reason}}. You can retry payment here: {{retry_url}}'
    },
    {
      id: 'order_confirmed',
      eventType: 'order.confirmed',
      channel: 'WHATSAPP',
      title: 'Order Confirmed',
      templateText: '📦 Order Confirmed: Great news {{customer_name}}! Order *#{{order_id}}* has been reviewed and confirmed by our warehouse team. Next step: Packing & Dispatch.'
    },
    {
      id: 'order_shipped',
      eventType: 'order.shipped',
      channel: 'WHATSAPP',
      title: 'Order Shipped with Tracking',
      templateText: '🚚 On The Way! {{customer_name}}, your order *#{{order_id}}* has been dispatched via {{carrier}}. Tracking Number: *{{tracking_number}}*. Expected Delivery: {{expected_delivery}}.'
    },
    {
      id: 'order_delayed',
      eventType: 'order.delayed',
      channel: 'WHATSAPP',
      title: 'Order Delivery Delayed',
      templateText: '⏳ Delivery Update: Hello {{customer_name}}, due to transit delays with {{carrier}}, your order *#{{order_id}}* has been delayed. Revised Delivery: *{{expected_delivery}}*. We apologize for the inconvenience.'
    },
    {
      id: 'order_delivered',
      eventType: 'order.delivered',
      channel: 'WHATSAPP',
      title: 'Order Delivered',
      templateText: '🌟 Delivered! Your order *#{{order_id}}* has been delivered to your address. We hope you love your purchase! Need help? Reply to this message or visit our Support Center.'
    },
    {
      id: 'order_cancelled',
      eventType: 'order.cancelled',
      channel: 'WHATSAPP',
      title: 'Order Cancelled',
      templateText: '❌ Order Cancelled: Order *#{{order_id}}* has been cancelled as requested. If any payment was deducted, refund of ₹{{amount}} will be credited to your original payment method within 3-5 working days.'
    },
    {
      id: 'refund',
      eventType: 'payment.refunded',
      channel: 'WHATSAPP',
      title: 'Refund Processed',
      templateText: '💳 Refund Completed: Dear {{customer_name}}, a refund of *₹{{amount}}* for Order *#{{order_id}}* has been processed to your account (Ref: {{refund_id}}).'
    }
  ];

  for (const t of templates) {
    repos.notifications.upsertTemplate(t);
  }
  console.log(`[Seed] Seeded ${templates.length} WhatsApp notification templates`);

  // 2. Seed Categories (Section 8)
  const categories = [
    {
      id: 'CAT_AUDIO',
      name: 'Hi-Fi Audio & Headphones',
      slug: 'audio-headphones',
      description: 'Audiophile grade noise-canceling headphones, wireless earbuds, and studio monitors.',
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
      sortOrder: 1
    },
    {
      id: 'CAT_WEARABLES',
      name: 'Smart Wearables',
      slug: 'smart-wearables',
      description: 'Next-generation fitness trackers, AMOLED smartwatches, and biometric rings.',
      imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
      sortOrder: 2
    },
    {
      id: 'CAT_KEYBOARDS',
      name: 'Mechanical Keyboards & Tech',
      slug: 'mechanical-keyboards',
      description: 'Custom hot-swappable mechanical keyboards, artisan keycaps, and desk accessories.',
      imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&auto=format&fit=crop&q=80',
      sortOrder: 3
    },
    {
      id: 'CAT_LIFESTYLE',
      name: 'Premium EDC & Travel',
      slug: 'edc-travel',
      description: 'Waterproof backpacks, titanium accessories, and minimalist everyday carry essentials.',
      imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&auto=format&fit=crop&q=80',
      sortOrder: 4
    }
  ];

  for (const c of categories) {
    repos.categories.create(c);
  }
  console.log(`[Seed] Seeded ${categories.length} product categories`);

  // 3. Seed Realistic Products with SKU Asset Structures (Section 9 & 10)
  const products = [
    {
      sku: 'SKU-10001',
      name: 'AcousticPro Wireless ANC Headphones',
      slug: 'acousticpro-wireless-anc-headphones',
      description: 'Engineered with custom 40mm beryllium drivers, active hybrid noise cancellation up to 45dB, and 50 hours of lossless playback on a single charge. Features plush memory foam earcups and Bluetooth 5.4 with LDAC support.',
      shortDescription: 'Hybrid Active Noise-Cancelling Audiophile Wireless Headphones with 50hr battery',
      price: 14999.00,
      discountPrice: 12499.00,
      categoryId: 'CAT_AUDIO',
      brand: 'AcousticPro',
      stock: 45,
      dimensions: '180 x 200 x 75 mm',
      weight: '265g',
      materials: 'Aerospace Grade Aluminum, Protein Leather, Memory Foam',
      images: [
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&auto=format&fit=crop&q=80'
      ],
      variants: [
        { name: 'Matte Obsidian Black', sku: 'SKU-10001-BLK', price: 12499.00, stock: 25, attributes: { color: 'Obsidian Black' } },
        { name: 'Lunar Silver', sku: 'SKU-10001-SLV', price: 12499.00, stock: 20, attributes: { color: 'Lunar Silver' } }
      ]
    },
    {
      sku: 'SKU-10002',
      name: 'Apex Horizon Ultra AMOLED Smartwatch',
      slug: 'apex-horizon-ultra-amoled-smartwatch',
      description: 'Precision aerospace titanium casing with a vibrant 1.43-inch sapphire crystal AMOLED display. Features dual-frequency multi-satellite GPS, continuous ECG monitoring, and 10ATM water resistance rated for deep ocean diving.',
      shortDescription: 'Titanium Smartwatch with Dual GPS, Sapphire Crystal, and ECG tracking',
      price: 24999.00,
      discountPrice: 19999.00,
      categoryId: 'CAT_WEARABLES',
      brand: 'Apex Systems',
      stock: 30,
      dimensions: '46 x 46 x 11.5 mm',
      weight: '52g',
      materials: 'Titanium Grade 5, Sapphire Crystal, Fluoroelastomer strap',
      images: [
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&auto=format&fit=crop&q=80'
      ],
      variants: [
        { name: 'Space Gray / Sport Band', sku: 'SKU-10002-GRY', price: 19999.00, stock: 15, attributes: { finish: 'Space Gray' } },
        { name: 'Raw Titanium / Milanese Loop', sku: 'SKU-10002-TIT', price: 21999.00, stock: 15, attributes: { finish: 'Raw Titanium' } }
      ]
    },
    {
      sku: 'SKU-10003',
      name: 'CyberType K75 Wireless Gasket Mechanical Keyboard',
      slug: 'cybertype-k75-wireless-gasket-mechanical-keyboard',
      description: '75% compact enthusiast mechanical keyboard with south-facing RGB, hot-swappable 5-pin sockets, triple-mode wireless connectivity (2.4G/BT/USB-C), and factory-lubed custom linear switches on sound-dampening gasket mounts.',
      shortDescription: 'Custom 75% Gasket-Mount Mechanical Keyboard with CNC Aluminum Knob',
      price: 8999.00,
      discountPrice: 7499.00,
      categoryId: 'CAT_KEYBOARDS',
      brand: 'CyberType',
      stock: 60,
      dimensions: '325 x 140 x 38 mm',
      weight: '980g',
      materials: 'CNC Anodized Aluminum, PBT Dye-Sub Keycaps, Poron Foam',
      images: [
        'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?w=800&auto=format&fit=crop&q=80'
      ],
      variants: [
        { name: 'Matcha Green / Linear Cream', sku: 'SKU-10003-MTC', price: 7499.00, stock: 35, attributes: { switch: 'Linear Cream' } },
        { name: 'Midnight Navy / Tactile Moss', sku: 'SKU-10003-NVY', price: 7499.00, stock: 25, attributes: { switch: 'Tactile Moss' } }
      ]
    },
    {
      sku: 'SKU-10004',
      name: 'Nomad Venture Waterproof Tech Commuter Pack 24L',
      slug: 'nomad-venture-waterproof-commuter-pack-24l',
      description: 'Crafted from Cordura 500D waterproof ballistic nylon with YKK AquaGuard weatherproof zippers. Dedicated suspended 16-inch laptop compartment, hidden RFID-shielded passport pocket, and magnetic Fidlock chest buckle.',
      shortDescription: 'Weatherproof 24L Tech Commuter Backpack with dedicated 16-inch laptop suite',
      price: 6499.00,
      discountPrice: 5299.00,
      categoryId: 'CAT_LIFESTYLE',
      brand: 'Nomad Essentials',
      stock: 40,
      dimensions: '480 x 300 x 180 mm',
      weight: '1100g',
      materials: 'Cordura 500D Ballistic Nylon, Hypalon, YKK AquaGuard',
      images: [
        'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?w=800&auto=format&fit=crop&q=80'
      ],
      variants: [
        { name: 'Stealth Matte Black', sku: 'SKU-10004-BLK', price: 5299.00, stock: 25, attributes: { color: 'Matte Black' } },
        { name: 'Alpine Sage', sku: 'SKU-10004-SGE', price: 5299.00, stock: 15, attributes: { color: 'Alpine Sage' } }
      ]
    },
    {
      sku: 'SKU-10005',
      name: 'EchoPulse Studio TWS Earbuds with Spatial Audio',
      slug: 'echopulse-studio-tws-earbuds',
      description: 'True wireless studio earbuds with 11mm dual dynamic drivers, dynamic head-tracking spatial audio, 6-mic beamforming noise cancellation for crystal clear calls, and Qi wireless charging case.',
      shortDescription: 'Hi-Res True Wireless Earbuds with Dynamic Head-Tracking Spatial Audio',
      price: 5999.00,
      discountPrice: 4799.00,
      categoryId: 'CAT_AUDIO',
      brand: 'AcousticPro',
      stock: 50,
      dimensions: '60 x 48 x 25 mm',
      weight: '48g',
      materials: 'Polycarbonate, Liquid Silicone Tips',
      images: [
        'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80'
      ],
      variants: []
    }
  ];

  for (const p of products) {
    repos.products.create(p);
  }
  console.log(`[Seed] Seeded ${products.length} products with SKU directory structures`);

  // 4. Seed Canonical Users & Admin (Section 6 & 11)
  const adminUser = repos.users.upsertCanonicalUser({
    userId: 'USR_ADMIN_01',
    name: 'Lead Store Administrator',
    email: 'admin@store.local',
    mobile: '+919999900000',
    role: 'ADMIN',
    status: 'ACTIVE'
  });

  const customer1 = repos.users.upsertCanonicalUser({
    userId: 'USR_RAHUL_01',
    name: 'Rahul Sharma',
    email: 'rahul.sharma@example.com',
    mobile: '+919876543210',
    role: 'CUSTOMER',
    status: 'ACTIVE'
  });

  const customer2 = repos.users.upsertCanonicalUser({
    userId: 'USR_PRIYA_01',
    name: 'Priya Patel',
    email: 'priya.patel@example.com',
    mobile: '+919876543211',
    role: 'CUSTOMER',
    status: 'ACTIVE'
  });

  // Link Identities
  repos.users.linkIdentity(customer1.id, 'whatsapp', customer1.mobile, { verifiedAt: new Date().toISOString() });
  repos.users.linkIdentity(customer1.id, 'youpi_pg', 'CUST_YOUPI_001', { merchantId: '00000000-0000-0000-0000-000000000001' });

  console.log('[Seed] Seeded canonical users & admin accounts');

  // 5. Seed Sample Realistic Orders in Various Lifecycle States (Section 12 & 13)
  // Order 1: Delivered
  const order1 = repos.orders.createOrder({
    id: 'ORD_1001',
    orderNumber: 'ORD-20260901-1001',
    userId: customer1.id,
    customerName: customer1.name,
    customerEmail: customer1.email,
    customerMobile: customer1.mobile,
    shippingAddress: {
      recipientName: 'Rahul Sharma',
      phone: '+919876543210',
      addressLine1: 'Flat 402, Skyline Residency, Outer Ring Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560103',
      country: 'India'
    },
    totalAmount: 12499.00,
    subtotalAmount: 12499.00,
    paymentMethod: 'UPI',
    paymentStatus: 'SUCCESS',
    orderStatus: 'DELIVERED',
    notes: 'Please leave package at the security desk if unavailable'
  }, [
    {
      productId: 'PROD_SKU_10001',
      variantId: 'SKU-10001-BLK',
      sku: 'SKU-10001-BLK',
      name: 'AcousticPro Wireless ANC Headphones - Matte Obsidian Black',
      quantity: 1,
      unitPrice: 12499.00,
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=300&auto=format&fit=crop&q=80'
    }
  ]);

  repos.orders.updateStatus(order1.id, 'CONFIRMED', 'Payment verified and inventory allocated', 'SYSTEM');
  repos.orders.updateStatus(order1.id, 'PROCESSING', 'Packaged at Bengaluru Central Fulfillment Center', 'ADMIN', adminUser.id);
  repos.orders.updateStatus(order1.id, 'SHIPPED', 'Handed over to BlueDart courier with AWB #TRK-20260901-1001', 'ADMIN', adminUser.id);
  repos.orders.updateStatus(order1.id, 'DELIVERED', 'Delivered and OTP verified by recipient', 'GATEWAY');

  // Order 2: Shipped & In-Transit (UPI)
  const order2 = repos.orders.createOrder({
    id: 'ORD_1002',
    orderNumber: 'ORD-20260908-1002',
    userId: customer2.id,
    customerName: customer2.name,
    customerEmail: customer2.email,
    customerMobile: customer2.mobile,
    shippingAddress: {
      recipientName: 'Priya Patel',
      phone: '+919876543211',
      addressLine1: '12, Shanti Kunj, Linking Road, Bandra West',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400050',
      country: 'India'
    },
    totalAmount: 7499.00,
    subtotalAmount: 7499.00,
    paymentMethod: 'UPI',
    paymentStatus: 'SUCCESS',
    orderStatus: 'SHIPPED'
  }, [
    {
      productId: 'PROD_SKU_10003',
      variantId: 'SKU-10003-MTC',
      sku: 'SKU-10003-MTC',
      name: 'CyberType K75 Wireless Gasket Mechanical Keyboard - Matcha Green',
      quantity: 1,
      unitPrice: 7499.00,
      imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=300&auto=format&fit=crop&q=80'
    }
  ]);
  repos.orders.updateStatus(order2.id, 'CONFIRMED', 'Payment received via UPI intent', 'SYSTEM');
  repos.orders.updateStatus(order2.id, 'SHIPPED', 'In-transit via BlueDart Mumbai Air Hub', 'ADMIN', adminUser.id);

  // Order 3: Cash On Delivery (Placed / Pending confirmation)
  const order3 = repos.orders.createOrder({
    id: 'ORD_1003',
    orderNumber: 'ORD-20260914-1003',
    userId: customer1.id,
    customerName: customer1.name,
    customerEmail: customer1.email,
    customerMobile: customer1.mobile,
    shippingAddress: {
      recipientName: 'Rahul Sharma',
      phone: '+919876543210',
      addressLine1: 'Flat 402, Skyline Residency, Outer Ring Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560103',
      country: 'India'
    },
    totalAmount: 5299.00,
    subtotalAmount: 5299.00,
    paymentMethod: 'CASH',
    paymentStatus: 'PENDING',
    orderStatus: 'PLACED',
    notes: 'Cash on Delivery selected'
  }, [
    {
      productId: 'PROD_SKU_10004',
      variantId: 'SKU-10004-BLK',
      sku: 'SKU-10004-BLK',
      name: 'Nomad Venture Waterproof Tech Commuter Pack 24L - Stealth Matte Black',
      quantity: 1,
      unitPrice: 5299.00,
      imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=300&auto=format&fit=crop&q=80'
    }
  ]);

  console.log('[Seed] Seeded sample orders across lifecycle states (DELIVERED, SHIPPED, PLACED)');

  // 6. Seed Sample Support Ticket & Messages (Section 23 & 24)
  const ticket = repos.support.createTicket({
    id: 'TKT_1001',
    userId: customer2.id,
    orderId: order2.id,
    subject: 'Estimated delivery date inquiry for mechanical keyboard',
    category: 'ORDER_INQUIRY',
    priority: 'MEDIUM',
    initialMessage: 'Hi! I ordered the CyberType K75 keyboard yesterday. Could you please confirm if it will reach Mumbai by Friday?'
  });

  repos.support.addMessage({
    ticketId: ticket.id,
    senderType: 'admin',
    senderId: adminUser.id,
    messageType: 'text',
    content: 'Hello Priya! Your order is currently in transit with BlueDart Express (AWB: TRK-20260908-1002). The expected delivery is Thursday evening, well before Friday. We are tracking it closely for you!'
  });

  console.log('[Seed] Seeded support ticket with customer/agent chat conversation');

  // 7. Seed Sample Product Reviews with Verified Status (Top Verified Reviews)
  const sampleReviews = [
    {
      id: 'REV_1001',
      productId: 'PROD_SKU_10001',
      userId: customer1.id,
      userName: customer1.name,
      rating: 5,
      title: 'Remarkable sound stage and battery endurance!',
      comment: 'The hybrid ANC cuts out all drone and street noise. 50 hours battery claim is genuine. Extremely comfortable for all-day coding sessions.',
      isVerified: 1, // Top Verified Review
      isFeatured: 1
    },
    {
      id: 'REV_1002',
      productId: 'PROD_SKU_10001',
      userId: customer2.id,
      userName: customer2.name,
      rating: 4,
      title: 'Crisp audio, slightly firm headband at first',
      comment: 'Audio fidelity is 10/10 with LDAC enabled. Headband loosened up nicely after a few days. Very premium packaging.',
      isVerified: 1,
      isFeatured: 0
    },
    {
      id: 'REV_1003',
      productId: 'PROD_SKU_10003',
      userId: customer2.id,
      userName: customer2.name,
      rating: 5,
      title: 'Cream linear switches are pure thock heaven!',
      comment: 'Factory lubing is surprisingly uniform. South-facing RGB shines beautifully through the PBT dye-sub keycaps. Aluminum volume knob feels tactile.',
      isVerified: 1,
      isFeatured: 1
    },
    {
      id: 'REV_1004',
      productId: 'PROD_SKU_10003',
      userId: customer1.id,
      userName: customer1.name,
      rating: 4,
      title: 'Great wireless connectivity on Mac and Windows',
      comment: 'Switches between 2.4G dongle and Bluetooth seamlessly. Battery lasts 2+ weeks with RGB off.',
      isVerified: 0, // Unverified review shown after verified reviews
      isFeatured: 0
    }
  ];

  for (const r of sampleReviews) {
    repos.reviews.createReview(r);
  }
  console.log(`[Seed] Seeded ${sampleReviews.length} product reviews (with top verified reviews)`);

  // 8. Seed Sample Telegram Subscriber for Monitoring (Section 34)
  repos.telegram.upsertSubscriber({
    telegramUserId: '100000001',
    chatId: process.env.TELEGRAM_ADMIN_CHAT_ID || '100000001',
    username: 'ops_lead_bot',
    firstName: 'Platform',
    lastName: 'Operations',
    isAdmin: true
  });
  console.log('[Seed] Seeded default Telegram monitoring subscriber');

  // 8. Seed Audit Log Record (Section 43)
  repos.audit.logAction({
    actor: 'SYSTEM_INSTALLER',
    action: 'PLATFORM_SEEDED',
    resource: 'platform',
    resourceId: 'ALL',
    afterData: { categories: categories.length, products: products.length, orders: 3, timestamp: new Date().toISOString() }
  });

  console.log('[Seed] ✅ Database seeding finished successfully!');
  return { success: true };
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase().catch(err => {
    console.error('[Seed] Error during seeding:', err);
    process.exit(1);
  });
}
