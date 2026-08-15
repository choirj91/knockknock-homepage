import type { Product } from "@/data/products";

const statusLabel: Record<Product["status"], string> = {
  live: "운영 중",
  beta: "베타",
  "coming-soon": "준비 중",
};

const statusDot: Record<Product["status"], string> = {
  live: "bg-emerald-400",
  beta: "bg-amber-400",
  "coming-soon": "bg-navy/30",
};

export default function ProductCard({ product }: { product: Product }) {
  const card = (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white transition duration-300 hover:-translate-y-1 hover:border-violet/50 hover:shadow-xl hover:shadow-navy/10">
      {/* cover */}
      <div
        className={`relative aspect-[16/9] overflow-hidden bg-gradient-to-br ${product.cover}`}
      >
        {/* oversized monogram */}
        <span className="absolute -bottom-7 right-3 select-none text-[7rem] font-black leading-none tracking-tighter text-mist/15 transition duration-500 group-hover:text-mist/25">
          {product.monogram}
        </span>
        <span className="absolute left-5 top-5 text-xs font-semibold uppercase tracking-[0.25em] text-mist/70">
          {product.nameEn}
        </span>
        <span className="absolute bottom-4 left-5 flex items-center gap-2 rounded-full bg-navy/30 px-3 py-1 text-xs font-medium text-mist backdrop-blur-sm">
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusDot[product.status]}`}
          />
          {statusLabel[product.status]}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-xl font-bold tracking-tight">{product.name}</h3>
        <p className="mt-1 text-sm font-semibold text-violet">
          {product.tagline}
        </p>
        <p className="mt-3 flex-1 text-sm leading-relaxed text-navy/70">
          {product.description}
        </p>

        {product.stats && (
          <dl className="mt-5 grid grid-cols-3 divide-x divide-navy/10 rounded-xl border border-navy/10 py-3 text-center">
            {product.stats.map((s) => (
              <div key={s.label}>
                <dd className="text-base font-bold">{s.value}</dd>
                <dt className="mt-0.5 text-xs text-navy/50">{s.label}</dt>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {product.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-navy/10 px-2.5 py-1 text-xs font-medium text-navy/60"
            >
              {tag}
            </span>
          ))}
          {product.url && (
            <span className="ml-auto flex items-center gap-1 text-sm font-semibold text-violet transition group-hover:gap-2 group-hover:text-navy">
              바로가기
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <path
                  d="M2 7h10M8 3l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </div>
      </div>
    </article>
  );

  return product.url ? (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block h-full"
    >
      {card}
    </a>
  ) : (
    card
  );
}
