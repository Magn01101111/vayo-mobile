export interface CatalogCategory {
  id: string;
  label: string;
  slug: string;
  active?: boolean;
}

export interface ProductSpec {
  label: string;
  value: string;
}

export interface ProductDocument {
  title: string;
  meta: string;
  url?: string;
}

export interface ProductProvider {
  id?: string;
  name: string;
  location: string;
  deliveryTime: string;
  speed: 'fast' | 'mid' | 'slow';
}

export interface ProductCardData {
  id: string;
  category: string;
  categorySlug: string;
  name: string;
  sku: string;
  description?: string;
  price: string;
  priceRaw?: number | null;
  imageUrl?: string;
  images?: string[];
  shortStatus: string;
  stockLabel: string;
  stockRaw?: number | null;
  availabilityStatus?: string | null;
  isPurchasable?: boolean;
  isFeatured?: boolean;
  offerPrice?: string | null;
  offerPriceRaw?: number | null;
  offerEndsAt?: string | null;
  offerDiscountPercent?: number;
  tags: string[];
}

export interface ProductDetailData {
  id: string;
  category: string;
  categorySlug: string;
  name: string;
  sku: string;
  description?: string;
  price: string;
  priceRaw?: number | null;
  imageUrl?: string;
  images?: string[];
  shortStatus: string;
  stockLabel: string;
  stockRaw?: number | null;
  availabilityStatus?: string | null;
  isPurchasable?: boolean;
  isFeatured?: boolean;
  offerPrice?: string | null;
  offerPriceRaw?: number | null;
  offerEndsAt?: string | null;
  offerDiscountPercent?: number;
  brand: string;
  model?: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  specs: ProductSpec[];
  dimensions: {
    height?: string;
    width?: string;
    length?: string;
    diameter?: string;
    netWeight?: string;
    grossWeight?: string;
  };
  compatibility: string[];
  documents: ProductDocument[];
  suppliers: ProductProvider[];
}
