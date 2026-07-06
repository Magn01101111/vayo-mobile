import type { UserRole } from '../constants/roles';

// ── Products ─────────────────────────────────────────────────────────────────

export type ApiProductAvailabilityStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'on_request'
  | 'discontinued';

export interface ApiCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
}

export interface ApiProductSpec {
  key?: string;
  label: string;
  value: string;
}

export interface ApiProductDimensions {
  heightMm?: number;
  widthMm?: number;
  lengthMm?: number;
  diameterMm?: number;
  netWeightKg?: number;
  grossWeightKg?: number;
}

export interface ApiProductDocument {
  title: string;
  type: 'pdf' | 'doc' | 'image' | 'other';
  sizeMb?: number;
  provider?: string;
  url?: string;
}

export interface ApiProductImage {
  url: string;
  publicId?: string | null;
}

export interface ApiProductListItem {
  id: string;
  categoryId?: string;
  categoryName?: string;
  name: string;
  sku: string;
  description?: string;
  brand: string;
  model?: string;
  price: number | null;
  currency: 'CLP';
  stock: number;
  availabilityStatus: ApiProductAvailabilityStatus;
  images?: ApiProductImage[];
  /** @deprecated Usar `images[0].url`. */
  imageUrl?: string;
  /** @deprecated Usar `images[0].publicId`. */
  imagePublicId?: string | null;
  isActive: boolean;
  isFeatured?: boolean;
  offerPrice?: number | null;
  offerStartsAt?: string | null;
  offerEndsAt?: string | null;
  tags: string[];
}

export interface ApiBanner {
  _id: string;
  title: string;
  subtitle?: string;
  imageUrl: string;
  link?: string;
  order: number;
  isActive: boolean;
}

export interface ApiFavorite {
  _id?: string;
  productId: string;
}

export interface ApiProductSupplier {
  id: string;
  name?: string;
  location?: string;
  deliveryTime: string;
  speed: 'fast' | 'mid' | 'slow';
}

export interface ApiProductDetail extends ApiProductListItem {
  category: {
    id: string;
    name: string;
    slug: string;
  };
  specs: ApiProductSpec[];
  dimensions?: ApiProductDimensions;
  compatibility: string[];
  documents: ApiProductDocument[];
  suppliers?: ApiProductSupplier[];
  createdAt?: string;
  updatedAt?: string;
}

// ── Reviews ────────────────────────────────────────────────────────────────────

export type ApiReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ApiReview {
  id: string;
  productId: string;
  authorName: string;
  authorCompany?: string;
  rating: number;
  body: string;
  tags: string[];
  verified: boolean;
  status: ApiReviewStatus;
  createdAt?: string;
  product?: { id: string; name: string; sku: string } | null;
}

export interface ApiReviewSummary {
  count: number;
  average: number;
}

export interface CreateReviewPayload {
  rating: number;
  body: string;
  tags?: string[];
  authorCompany?: string;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export type ApiUserRole = UserRole;

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  position?: string;
  role: UserRole;
  isActive: boolean;
  profileImage?: string;
  createdAt?: string;
}

// ── Company ───────────────────────────────────────────────────────────────────

export interface ApiCompany {
  id?: string;
  name: string;
  rut?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;
  ivaPercent: number;
  invoiceTerms?: string;
}

// ── API Response wrappers ─────────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface ApiPaginatedResponse<T> {
  ok: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  message?: string;
}

export interface ApiErrorResponse {
  ok: false;
  error: string;
  errors?: { field: string; message: string }[];
}

// ── Quotes (historial cliente) ────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface ApiQuote {
  _id: string;
  folio: string;
  clientId?: string | null;
  createdBy?: string | null;
  client?: { name?: string; email?: string; phone?: string };
  items?: Array<{
    productId: string;
    name: string;
    sku?: string;
    price: number;
    listPrice?: number | null;
    offerPrice?: number | null;
    offerApplied?: boolean;
    offerDiscountPercent?: number | null;
    quantity: number;
    total: number;
  }>;
  totals?: { subtotal?: number; discount?: number; iva?: number; total?: number };
  manualDiscount?: { percent?: number; amount?: number; reason?: string };
  metadata?: { status?: QuoteStatus };
  viewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// ── Sales (historial cliente) ─────────────────────────────────────────────────

export type SaleStatus = 'pending' | 'paid' | 'cancelled';
export type SalePaymentMethod = 'cash' | 'transfer' | 'card' | 'credit' | 'other';

export interface ApiSale {
  id: string;
  folio: string;
  quoteId?: string | null;
  quoteFolio?: string;
  clientId?: string | null;
  client?: { name?: string; email?: string; phone?: string; company?: string };
  items?: Array<{
    productId: string;
    name: string;
    sku?: string;
    price: number;
    listPrice?: number | null;
    offerPrice?: number | null;
    offerApplied?: boolean;
    offerDiscountPercent?: number | null;
    quantity: number;
    total: number;
  }>;
  totals?: { subtotal?: number; discount?: number; iva?: number; total?: number };
  manualDiscount?: { percent?: number; amount?: number; reason?: string };
  status?: SaleStatus;
  paymentMethod?: SalePaymentMethod;
  createdAt?: string;
  updatedAt?: string;
}
