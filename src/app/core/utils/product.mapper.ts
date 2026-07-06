import { ApiProductListItem, ApiProductDetail } from '../models/api.models';
import { ProductCardData, ProductDetailData } from '../models/ui.models';

const AVAILABILITY: Record<string, string> = {
  in_stock: 'Disponible',
  out_of_stock: 'Sin stock',
  on_request: 'A pedido',
  discontinued: 'Descontinuado',
};

function formatCLP(value: number | null | undefined): string {
  if (value == null) return 'Consultar';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
}

function isActiveOffer(p: Pick<ApiProductListItem, 'offerPrice' | 'price' | 'offerStartsAt' | 'offerEndsAt'>): boolean {
  if (p.offerPrice == null || p.price == null || p.offerPrice <= 0 || p.offerPrice >= p.price) return false;
  const now = Date.now();
  const starts = p.offerStartsAt ? new Date(p.offerStartsAt).getTime() : null;
  const ends = p.offerEndsAt ? new Date(p.offerEndsAt).getTime() : null;
  if (starts != null && !Number.isNaN(starts) && starts > now) return false;
  if (ends != null && !Number.isNaN(ends) && ends < now) return false;
  return true;
}

export function mapToProductCard(
  p: ApiProductListItem,
  categoryLabel = p.categoryName ?? 'Sin categoría',
  categorySlug = '',
): ProductCardData {
  const hasOffer = isActiveOffer(p);
  const effectivePrice = hasOffer ? p.offerPrice : p.price;
  const offerPct =
    hasOffer && p.offerPrice && p.price
      ? Math.round((1 - p.offerPrice / p.price) * 100)
      : undefined;
  const isPurchasable =
    p.isActive !== false &&
    p.availabilityStatus === 'in_stock' &&
    (p.stock ?? 0) > 0 &&
    effectivePrice != null &&
    effectivePrice > 0;

  return {
    id: p.id,
    category: categoryLabel,
    categorySlug,
    name: p.name,
    sku: p.sku,
    description: p.description,
    price: formatCLP(p.price),
    priceRaw: p.price,
    imageUrl: p.images?.[0]?.url ?? p.imageUrl,
    images: p.images?.map((i) => i.url),
    shortStatus: AVAILABILITY[p.availabilityStatus] ?? p.availabilityStatus,
    stockLabel: p.stock > 0 ? `${p.stock} en stock` : 'Sin stock',
    stockRaw: p.stock,
    availabilityStatus: p.availabilityStatus,
    isPurchasable,
    isFeatured: p.isFeatured,
    offerPrice: hasOffer && p.offerPrice != null ? formatCLP(p.offerPrice) : null,
    offerPriceRaw: hasOffer ? p.offerPrice ?? null : null,
    offerEndsAt: hasOffer ? p.offerEndsAt ?? null : null,
    offerDiscountPercent: offerPct,
    tags: p.tags ?? [],
  };
}

export function mapToProductDetail(p: ApiProductDetail): ProductDetailData {
  const card = mapToProductCard(p, p.category?.name, p.category?.slug);
  return {
    ...card,
    brand: p.brand,
    model: p.model,
    rating: 0,
    reviewCount: 0,
    specs: (p.specs ?? []).map((s) => ({ label: s.label, value: s.value })),
    dimensions: {
      height:
        p.dimensions?.heightMm != null
          ? `${p.dimensions.heightMm} mm`
          : undefined,
      width:
        p.dimensions?.widthMm != null
          ? `${p.dimensions.widthMm} mm`
          : undefined,
      length:
        p.dimensions?.lengthMm != null
          ? `${p.dimensions.lengthMm} mm`
          : undefined,
      diameter:
        p.dimensions?.diameterMm != null
          ? `${p.dimensions.diameterMm} mm`
          : undefined,
      netWeight:
        p.dimensions?.netWeightKg != null
          ? `${p.dimensions.netWeightKg} kg`
          : undefined,
      grossWeight:
        p.dimensions?.grossWeightKg != null
          ? `${p.dimensions.grossWeightKg} kg`
          : undefined,
    },
    compatibility: p.compatibility ?? [],
    documents: (p.documents ?? []).map((d) => ({
      title: d.title,
      meta: `${d.type.toUpperCase()}${d.sizeMb ? ` · ${d.sizeMb} MB` : ''}`,
      url: d.url,
    })),
    suppliers: (p.suppliers ?? []).map((s) => ({
      id: s.id,
      name: s.name ?? '—',
      location: s.location ?? '—',
      deliveryTime: s.deliveryTime,
      speed: s.speed,
    })),
  };
}
