import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ProductCard from "@/components/ProductCard";
import { products } from "@/data/products";

const values = [
  {
    number: "01",
    title: "불편함을 찾습니다",
    description:
      "일상 속에서 사람들이 당연하게 참고 있는 불편함을 발견하는 것에서 시작합니다.",
  },
  {
    number: "02",
    title: "편리함으로 바꿉니다",
    description:
      "발견한 불편함을 소프트웨어의 힘으로 누구나 쓸 수 있는 편리함으로 바꿉니다.",
  },
  {
    number: "03",
    title: "똑똑, 문을 두드립니다",
    description:
      "완성된 제품으로 사람들의 일상에 노크합니다. 문이 열리면 삶이 한 뼘 더 편해집니다.",
  },
];

function SectionHeading({
  eyebrow,
  title,
  description,
  center = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "text-center" : ""}>
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-violet">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
        {title}
      </h2>
      <p
        className={`mt-3 max-w-lg leading-relaxed text-navy/60 ${center ? "mx-auto" : ""}`}
      >
        {description}
      </p>
    </div>
  );
}

/** Concentric knock-ripple ornament */
function KnockRipple({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="200" cy="200" r="60" stroke="#7886C7" strokeWidth="1.5" opacity="0.9" />
      <circle cx="200" cy="200" r="105" stroke="#7886C7" strokeWidth="1.5" opacity="0.6" />
      <circle cx="200" cy="200" r="150" stroke="#A9B5DF" strokeWidth="1.5" opacity="0.5" />
      <circle cx="200" cy="200" r="195" stroke="#A9B5DF" strokeWidth="1.5" opacity="0.35" />
      <circle cx="200" cy="200" r="14" fill="#2D336B" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <Header />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          {/* dot grid */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(#A9B5DF_1px,transparent_1px)] [background-size:28px_28px]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-mist/40 via-mist/85 to-mist"
          />
          <KnockRipple className="pointer-events-none absolute -right-24 top-1/2 hidden w-[480px] -translate-y-1/2 lg:block" />

          <div className="relative mx-auto max-w-6xl px-5 py-24 sm:py-36">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet">
                Knock Knock Company
              </p>
              <h1 className="mt-5 text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-7xl">
                똑똑,
                <br />
                <span className="text-violet">똑똑한 회사</span>
              </h1>
              <p className="mt-7 max-w-md text-base leading-relaxed text-navy/60 sm:text-lg">
                사람들의 삶을 편리하게 만드는 것이 우리의 목표입니다. 일상의
                모든 불편함을 편리함으로 바꿉니다.
              </p>
              <div className="mt-10 flex gap-3">
                <a
                  href="#products"
                  className="rounded-xl bg-navy px-6 py-3.5 text-sm font-semibold text-mist shadow-lg shadow-navy/20 transition hover:bg-violet"
                >
                  제품 둘러보기
                </a>
                <a
                  href="#contact"
                  className="rounded-xl border border-navy/15 bg-white/70 px-6 py-3.5 text-sm font-semibold transition hover:border-violet hover:text-violet"
                >
                  문의하기
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Products */}
        <section id="products" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <SectionHeading
              eyebrow="Products"
              title="제품"
              description="낰낰컴퍼니가 만든 제품들입니다. 하나씩 늘려가고 있습니다."
            />
            <div
              className={`mt-12 grid gap-6 ${products.length > 1 ? "sm:grid-cols-2" : "max-w-xl"}`}
            >
              {products.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
            <p className="mt-8 text-sm leading-relaxed text-navy/50">
              다음 제품을 준비하고 있습니다. 제휴나 제안이 있다면{" "}
              <a
                href="mailto:admin@knockknock.company"
                className="text-violet underline underline-offset-4"
              >
                admin@knockknock.company
              </a>
              로 알려주세요.
            </p>
          </div>
        </section>

        {/* About */}
        <section id="about" className="scroll-mt-16 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <SectionHeading
              eyebrow="How we work"
              title="우리가 일하는 방식"
              description="낰낰(Knock Knock)이라는 이름처럼, 우리는 불편함이 있는 곳의 문을 두드립니다."
              center
            />
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-navy/10 bg-navy/10 sm:grid-cols-3">
              {values.map((v) => (
                <div key={v.number} className="bg-white p-8">
                  <p className="text-sm font-bold tracking-widest text-periwinkle">
                    {v.number}
                  </p>
                  <h3 className="mt-5 text-lg font-bold tracking-tight">
                    {v.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-navy/60">
                    {v.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <div className="relative overflow-hidden rounded-3xl bg-navy px-6 py-16 text-center text-mist sm:px-12 sm:py-20">
              <KnockRipple className="pointer-events-none absolute -left-40 -top-40 w-[420px] opacity-40" />
              <KnockRipple className="pointer-events-none absolute -bottom-48 -right-32 w-[420px] opacity-40" />
              <div className="relative">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-periwinkle">
                  Contact
                </p>
                <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                  똑똑, 문 열어주세요
                </h2>
                <p className="mx-auto mt-4 max-w-md leading-relaxed text-mist/70">
                  제품 문의, 제휴 제안, 그리고 여러분이 겪는 불편함까지 —
                  무엇이든 편하게 두드려 주세요.
                </p>
                <a
                  href="mailto:admin@knockknock.company"
                  className="mt-9 inline-block rounded-xl bg-mist px-7 py-3.5 text-sm font-bold text-navy transition hover:bg-periwinkle"
                >
                  admin@knockknock.company
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
