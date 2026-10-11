import { defaultLogger } from '../../../packages/common/src/logger.js';

export class ShiprocketCalculatorEngine {
  constructor(options = {}) {
    this.logger = options.logger || defaultLogger;
    this.defaultPickupPincode = options.defaultPickupPincode || process.env.SHIPPING_PICKUP_PINCODE || '110059';
    this.cache = new Map(); // key: `${pickup}-${delivery}-${weight}-${cod}-${value}` -> { rates, avgRate, expiresAt }
    this.cacheTtlMs = 15 * 60 * 1000; // 15 minutes cache
  }

  /**
   * Calculates surface shipping rate using Shiprocket calculator endpoint
   * @param {Object} params
   * @param {string|number} params.pickupPincode
   * @param {string|number} params.deliveryPincode
   * @param {number} params.weightInKg - Total weight in Kilograms (e.g. 0.4, 0.8, 1.2)
   * @param {number} params.shipmentValue - Cart item subtotal value
   * @param {boolean|number} [params.cod=1] - 1 for COD, 0 for Prepaid (default 1 as requested)
   * @returns {Promise<{ success: boolean, averageRate: number, providers: Array, pickupPincode: string, deliveryPincode: string, weightKg: number }>}
   */
  async calculateSurfaceRate({
    pickupPincode,
    deliveryPincode,
    weightInKg,
    shipmentValue = 1000,
    cod = 1
  }) {
    const pickup = String(pickupPincode || this.defaultPickupPincode).trim();
    const delivery = String(deliveryPincode || '').trim();
    const weight = Math.max(0.1, Math.round(Number(weightInKg || 0.5) * 100) / 100);
    const value = Math.max(1, Math.round(Number(shipmentValue || 100)));
    const paymentMode = cod ? 1 : 0;

    if (!delivery || delivery.length !== 6) {
      throw new Error(`Invalid destination delivery pincode: '${delivery}'. Must be 6 digits.`);
    }
    if (!pickup || pickup.length !== 6) {
      throw new Error(`Invalid origin pickup pincode: '${pickup}'. Must be 6 digits.`);
    }

    // Check cache
    const cacheKey = `${pickup}_${delivery}_${weight}_${paymentMode}_${value}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        success: true,
        cached: true,
        pickupPincode: pickup,
        deliveryPincode: delivery,
        weightKg: weight,
        shipmentValue: value,
        mode: 'surface',
        averageRate: cached.avgRate,
        providers: cached.providers
      };
    }

    const endpoint = `https://www.shiprocket.in/wp-json/sr-shc/v1/serviceability/domestic?pickup_postcode=${pickup}&delivery_postcode=${delivery}&weight=${weight}&cod=${paymentMode}&declared_value=${value}&breadth=10&length=10&height=10`;

    try {
      this.logger.info(`Calculating Shiprocket surface rate: ${pickup} -> ${delivery} (${weight}kg, Val: ₹${value})`, {
        category: 'shipping',
        details: { pickup, delivery, weight, value, paymentMode }
      });

      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Referer': 'https://www.shiprocket.in/shipping-rate-calculator/',
          'Accept': 'application/json, text/plain, */*'
        },
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        throw new Error(`Shiprocket calculator responded with HTTP ${response.status}`);
      }

      const json = await response.json();
      const couriers = json.data?.available_courier_companies?.surface || [];

      if (!Array.isArray(couriers) || couriers.length === 0) {
        // If surface returned empty, check if air or all couriers exist
        const airCouriers = json.data?.available_courier_companies?.air || [];
        const fallbackList = airCouriers.length > 0 ? airCouriers : [];
        if (fallbackList.length > 0) {
          const sample = fallbackList.slice(0, 5);
          const validRates = sample.map(c => Number(c.rate)).filter(r => !isNaN(r) && r > 0);
          const avg = validRates.length > 0 ? Math.round((validRates.reduce((a, b) => a + b, 0) / validRates.length) * 100) / 100 : 99;
          return {
            success: true,
            fallback: 'air',
            pickupPincode: pickup,
            deliveryPincode: delivery,
            weightKg: weight,
            averageRate: avg,
            providers: sample.map(c => ({ name: c.courier_name, rate: Number(c.rate) }))
          };
        }

        // Return baseline estimated rate if no couriers available for remote pincode
        const defaultRate = Math.round((70 + (weight * 60)) * 100) / 100;
        return {
          success: true,
          fallback: 'estimated',
          pickupPincode: pickup,
          deliveryPincode: delivery,
          weightKg: weight,
          averageRate: defaultRate,
          providers: [{ name: 'Standard Surface Express', rate: defaultRate }]
        };
      }

      // Take up to 5 providers from surface mode as instructed
      const selectedProviders = couriers.slice(0, 5);
      const rates = selectedProviders.map(c => Number(c.rate)).filter(r => !isNaN(r) && r > 0);

      // Average the 5 provider rates
      const sum = rates.reduce((acc, curr) => acc + curr, 0);
      const avgRate = rates.length > 0 ? Math.round((sum / rates.length) * 100) / 100 : 99;

      const result = {
        success: true,
        pickupPincode: pickup,
        deliveryPincode: delivery,
        weightKg: weight,
        shipmentValue: value,
        mode: 'surface',
        averageRate: avgRate,
        providerCount: selectedProviders.length,
        providers: selectedProviders.map(c => ({
          name: c.courier_name,
          rate: Number(c.rate),
          etdDays: c.estimated_delivery_days || null
        }))
      };

      // Save to cache
      this.cache.set(cacheKey, {
        avgRate,
        providers: result.providers,
        expiresAt: Date.now() + this.cacheTtlMs
      });

      return result;
    } catch (err) {
      this.logger.error(`Error querying Shiprocket rate calculator: ${err.message}`);
      // Fallback calculation: Rs. 65 base + Rs. 55 per kg
      const fallbackRate = Math.round((65 + (weight * 55)) * 100) / 100;
      return {
        success: true,
        fallback: true,
        error: err.message,
        pickupPincode: pickup,
        deliveryPincode: delivery,
        weightKg: weight,
        averageRate: fallbackRate,
        providers: [{ name: 'Blue Dart Surface (Fallback)', rate: fallbackRate }]
      };
    }
  }
}
