class MyntraMapper {
  map(raw) {
    return {
      externalProductId: raw.externalProductId || raw.id,
      title: raw.title,
      brand: raw.brand,
      category: raw.category || 'Fashion',
      subCategory: raw.subCategory,
      modelNumber: raw.modelNumber || raw.model,
      currentPrice: raw.currentPrice ?? raw.price,
      mrp: raw.mrp,
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
      identifiers: raw.identifiers,
    };
  }
}

module.exports = MyntraMapper;
