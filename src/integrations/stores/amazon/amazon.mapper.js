/**
 * Maps store-specific raw fields → common shape before normalization.
 */
class AmazonMapper {
  map(raw) {
    return {
      externalProductId: raw.externalProductId || raw.asin || raw.id,
      title: raw.title,
      brand: raw.brand,
      category: raw.category,
      subCategory: raw.subCategory,
      modelNumber: raw.modelNumber || raw.model,
      currentPrice: raw.currentPrice ?? raw.price,
      mrp: raw.mrp || raw.listPrice,
      currency: raw.currency || 'INR',
      availability: raw.availability,
      seller: raw.seller,
      productUrl: raw.productUrl,
      affiliateUrl: raw.affiliateUrl,
      images: raw.images,
      rating: raw.rating,
      reviewCount: raw.reviewCount,
      variant: raw.variant || raw.attributes,
      attributes: raw.attributes || raw.variant,
      asin: raw.asin || raw.externalProductId,
      identifiers: raw.identifiers,
    };
  }
}

module.exports = AmazonMapper;
