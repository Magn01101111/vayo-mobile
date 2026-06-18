import { environment } from '../../../environments/environment';

export const API_CONFIG = {
  baseUrl: environment.apiUrl,
  endpoints: {
    // Auth
    auth:                 'auth',
    register:             'auth/register',
    login:                'auth/login',
    logout:               'auth/logout',
    me:                   'auth/me',
    changePassword:       'auth/me/password',
    mePhoto:              'auth/me/photo',
    passwordResetRequest: 'auth/password-reset/request',
    passwordResetConfirm: 'auth/password-reset/confirm',

    // Catalog (public)
    categories: 'categories',
    products:   'products',

    // Company
    companyPublic: 'company/public',

    // Quotes / Sales
    quotes:         'quotes',
    sales:          'sales',
    salesFromQuote: 'sales/from-quote',

    // Coupons
    coupons:         'coupons',
    couponsValidate: 'coupons/validate',

    // Favorites
    favorites: 'favorites',

    // Reviews
    reviews: 'reviews',

    // Banners
    banners: 'banners',

    // ML (Fase 4 — B-ML)
    mlDetect: 'ml/detect',

    // Rewards (Fase 5 — B-REW)
    rewardsClaim: 'rewards/claim',

    // Cart sync (Fase 5 — B-CART)
    cart: 'cart',

    // Push devices (Fase 5 — B-PUSH)
    devicesPushToken: 'devices/push-token',
  },
} as const;
