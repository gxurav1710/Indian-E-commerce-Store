const fs = require('fs');
const chunks = require('./recovered-chunks.json');

const lines = [];

// 1. Lines 1 to 700 from recovered chunks
for (let i = 1; i <= 700; i++) {
  if (chunks[i] !== undefined) {
    lines.push(chunks[i]);
  }
}

// 2. Lines 701 to 1049: Bridging CSS
const bridgingCss = `      padding: 0.85rem 1rem;
      background: var(--bg-card-subtle);
      color: var(--text-heading);
      font-weight: 700;
      border-bottom: 2px solid var(--border);
    }
    .comparison-table td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-body);
    }
    .comparison-table tr:last-child td {
      border-bottom: none;
    }
    .comparison-table tr:hover td {
      background: rgba(37, 99, 235, 0.02);
    }
    .comparison-table .col-highlight {
      background: rgba(37, 99, 235, 0.05);
      color: #1d4ed8;
      font-weight: 600;
    }
    .comparison-table th.col-highlight {
      background: rgba(37, 99, 235, 0.08);
      color: #1d4ed8;
      border-bottom-color: #3b82f6;
    }

    /* FOOTER */
    footer {
      background: #020617;
      border-top: 1px solid #1e293b;
      padding: 2.5rem 1.5rem;
      margin-top: auto;
    }
    .footer-inner {
      max-width: 1280px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
    }
    .footer-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    /* LIGHTBOX MODAL */
    .lightbox-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.92);
      backdrop-filter: blur(8px);
      z-index: 999999;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      cursor: zoom-out;
    }
    .lightbox-modal.active {
      display: flex;
    }
    .lightbox-close-btn {
      position: absolute;
      top: 1.5rem;
      right: 1.5rem;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      font-size: 1.25rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .lightbox-close-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    .lightbox-img {
      max-width: 90vw;
      max-height: 85vh;
      border-radius: var(--radius-lg);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      cursor: default;
      object-fit: contain;
    }

    /* CELEBRATION MODAL */
    .celebration-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.8);
      backdrop-filter: blur(6px);
      z-index: 999998;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .celebration-modal.active {
      display: flex;
    }
    .celebration-card {
      background: #ffffff;
      border-radius: var(--radius-xl);
      padding: 2rem;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: popIn 0.25s ease-out;
    }
    @keyframes popIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .celebration-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: #dcfce7;
      color: #16a34a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      font-weight: 800;
      margin: 0 auto 1rem;
    }
    .receipt-box {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 1rem;
      margin: 1.25rem 0;
      text-align: left;
      font-size: 0.85rem;
    }
    .receipt-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.35rem 0;
      border-bottom: 1px dashed var(--border);
    }
    .receipt-row:last-child {
      border-bottom: none;
    }

    /* RESPONSIVE BREAKPOINTS */
    @media (max-width: 1024px) {
      .pdp-grid {
        grid-template-columns: 1fr;
        gap: 2rem;
      }
      .gallery-main-viewport {
        height: 380px;
      }
    }

    @media (max-width: 768px) {
      .top-announcement {
        font-size: 0.72rem;
        padding: 0.4rem 0.5rem;
        gap: 0.35rem;
      }
      header {
        padding: 0.75rem 1rem;
      }
      .header-inner {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
      }
      .product-showcase-container {
        padding: 1rem 0.75rem;
      }
      .gallery-main-viewport {
        height: 260px;
      }
      .product-h1 {
        font-size: 1.45rem;
      }
      .buy-box-card {
        padding: 1.25rem 1rem;
      }
      .price-main {
        font-size: 1.85rem;
      }
      .amount-selector-chips {
        gap: 0.4rem;
      }
      .chip-btn {
        padding: 0.45rem 0.65rem;
        font-size: 0.8rem;
      }
      .thumbnails-grid {`;

lines.push(bridgingCss);

// 3. Lines 1050 to 1118: Media query tail + Header start
for (let i = 1050; i <= 1124; i++) {
  if (chunks[i] !== undefined) {
    lines.push(chunks[i]);
  }
}

// 4. Closed </a> for brand-group then nav
lines.push('      </a>');

for (let i = 1125; i <= 1133; i++) {
  if (chunks[i] !== undefined) {
    lines.push(chunks[i]);
  }
}

// 5. Lines 1135 to 1845: Product Showcase HTML, Specs, Outcomes, Developer Guide
for (let i = 1135; i <= 1845; i++) {
  if (chunks[i] !== undefined) {
    let line = chunks[i];
    // Ensure buy box has id="purchase" for smooth scroll
    if (line.includes('class="buy-box-card"')) {
      line = '        <div class="buy-box-card" id="purchase">';
    }
    lines.push(line);
  }
}

// 6. Lines 1846 to 1859: Lightbox Open/Close functions
const lightboxJs = `    function openLightbox() {
      const modal = document.getElementById('lightboxModal');
      const img = document.getElementById('lightboxImg');
      if (modal && img) {
        img.src = photos[currentPhotoIndex].url;
        modal.classList.add('active');
      }
    }

    function closeLightbox() {
      const modal = document.getElementById('lightboxModal');
      if (modal) {
        modal.classList.remove('active');
      }
    }`;

lines.push(lightboxJs);

// 7. Lines 1860 to 2021: JS logic and event listeners
for (let i = 1860; i <= 2021; i++) {
  if (chunks[i] !== undefined) {
    lines.push(chunks[i]);
  }
}

const fullContent = lines.join('\n');
fs.writeFileSync('apps/coin-wallet-store/src/store.html', fullContent, 'utf8');
console.log('Successfully written store.html! Total lines:', fullContent.split('\n').length);
