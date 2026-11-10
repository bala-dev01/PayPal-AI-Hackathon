import "server-only";

/**
 * Channel3 product search. Docs: POST https://api.trychannel3.com/v1/search,
 * auth header x-api-key, body { query, limit }, response
 * { products: [{ title, offers: [{ url, domain, price: { price, currency }, availability }] }] }.
 * Price is a decimal number in the offer's currency. We convert to integer cents.
 */
export type ReplacementPrice = { cents: number; source: string; title: string } | { cents: null };

interface Offer {
  url?: string;
  domain?: string;
  price?: { price?: number; currency?: string };
  availability?: string;
}
interface Product {
  title?: string;
  offers?: Offer[];
}

export async function lookupReplacementPrice(query: string, apiKey: string): Promise<ReplacementPrice> {
  try {
    const res = await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query, limit: 5, config: { currency: "USD" } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { cents: null };
    const data = (await res.json()) as { products?: Product[] };
    for (const product of data.products ?? []) {
      const prices = (product.offers ?? [])
        .filter((o) => o.price?.currency === "USD" && typeof o.price.price === "number" && o.price.price > 0)
        .filter((o) => o.availability !== "OutOfStock")
        .map((o) => ({ cents: Math.round((o.price!.price as number) * 100), domain: o.domain ?? "" }))
        .sort((a, b) => a.cents - b.cents);
      if (prices.length === 0 || !product.title) continue;
      const mid = prices[Math.floor(prices.length / 2)];
      if (!mid) continue;
      return { cents: mid.cents, source: `Channel3${mid.domain ? `, ${mid.domain}` : ""}`, title: product.title };
    }
    return { cents: null };
  } catch {
    return { cents: null };
  }
}
