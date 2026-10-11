export { Database, getDatabase } from './database.js';
export { UsersRepository } from './repositories/users.repository.js';
export { CategoriesRepository } from './repositories/categories.repository.js';
export { ProductsRepository } from './repositories/products.repository.js';
export { CartsRepository } from './repositories/carts.repository.js';
export { OrdersRepository } from './repositories/orders.repository.js';
export { PaymentsRepository } from './repositories/payments.repository.js';
export { SupportRepository } from './repositories/support.repository.js';
export { NotificationsRepository } from './repositories/notifications.repository.js';
export { AuditRepository } from './repositories/audit.repository.js';
export { TelegramRepository } from './repositories/telegram.repository.js';
export { ReviewsRepository } from './repositories/reviews.repository.js';
export { CouponsRepository } from './repositories/coupons.repository.js';

import { getDatabase } from './database.js';
import { UsersRepository } from './repositories/users.repository.js';
import { CategoriesRepository } from './repositories/categories.repository.js';
import { ProductsRepository } from './repositories/products.repository.js';
import { CartsRepository } from './repositories/carts.repository.js';
import { OrdersRepository } from './repositories/orders.repository.js';
import { PaymentsRepository } from './repositories/payments.repository.js';
import { SupportRepository } from './repositories/support.repository.js';
import { NotificationsRepository } from './repositories/notifications.repository.js';
import { AuditRepository } from './repositories/audit.repository.js';
import { TelegramRepository } from './repositories/telegram.repository.js';
import { ReviewsRepository } from './repositories/reviews.repository.js';
import { CouponsRepository } from './repositories/coupons.repository.js';

/**
 * Creates and returns an assembled repositories bundle
 * @param {import('./database.js').Database} [dbInstance]
 */
export function createRepositories(dbInstance = null) {
  const db = dbInstance || getDatabase();
  return {
    db,
    users: new UsersRepository(db),
    categories: new CategoriesRepository(db),
    products: new ProductsRepository(db),
    carts: new CartsRepository(db),
    orders: new OrdersRepository(db),
    payments: new PaymentsRepository(db),
    support: new SupportRepository(db),
    notifications: new NotificationsRepository(db),
    audit: new AuditRepository(db),
    telegram: new TelegramRepository(db),
    reviews: new ReviewsRepository(db),
    coupons: new CouponsRepository(db)
  };
}
