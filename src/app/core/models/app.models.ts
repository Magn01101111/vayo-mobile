import { ProductCardData } from './ui.models';

export interface QuotationItem extends ProductCardData {
  qty: number;
  notes?: string;
  maxQty?: number;
  addedAt?: string;
}

export interface QuotationAddress {
  street?: string;
  number?: string;
  apt?: string;
  city?: string;
  region?: string;
  zip?: string;
  reference?: string;
}

export type CustomerType = 'person' | 'company';

export interface QuotationClient {
  customerType?: CustomerType;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  taxId?: string;
  businessActivity?: string;
  billingAddress?: QuotationAddress;
  shippingAddress?: QuotationAddress;
  shippingSameAsBilling?: boolean;
  notes?: string;
  acceptsTerms?: boolean;
  acceptsMarketing?: boolean;
}

export type CouponType = 'percentage' | 'fixed';

export interface Coupon {
  code: string;
  type: CouponType;
  value: number;
  minSubtotal?: number;
  description?: string;
  discount?: number;
}

export type QuotationCurrency = 'CLP' | 'USD' | 'UF';

export type PaymentTerms = 'contado' | '15-dias' | '30-dias' | '60-dias';

export type DeliveryTerms = 'pickup' | 'delivery' | 'shipping';

export interface QuoteItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice?: number | null;
}

export interface Quote {
  id: string;
  clientId?: string;
  clientName: string;
  items: QuoteItem[];
  status: 'draft' | 'sent' | 'approved' | 'rejected';
  createdAt: string;
  notes?: string;
}

export interface Sale {
  id: string;
  clientId: string;
  quoteId?: string;
  total: number;
  createdAt: string;
}

// ── Scanner / ML (contrato §9 del Plan Maestro) ───────────────────────────────

export interface ScannerDetection {
  label: string;
  partType: string;
  categorySlug?: string;
  searchTerm: string;
  confidence: number;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface DetectionTopPrediction {
  label: string;
  confidence: number;
  rejected: boolean;
  rejectReason?: 'negative_class' | 'low_confidence';
}

export interface DetectionResult {
  detections: ScannerDetection[];
  source: 'live' | 'upload';
  modelVersion: string;
  topPrediction?: DetectionTopPrediction;
}
