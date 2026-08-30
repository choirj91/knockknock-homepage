import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getAllPosts, formatDate } from "@/lib/blog";

export const metadata: Metadata = {
  title: "불편함 노트",
  description:
    "세상에 남아 있는 불편함을 찾아 기록합니다. 문제의 크기를 확인하고, 기존 해법이 어디서 멈췄는지 짚고, 우리라면 어떻게 풀지 적어둡니다.",
  alternates: { canonical: "/blog/" },
};

export default function BlogIndex() {
  const posts = getAllPosts();

  return (
    <>
      <Header />
      <main>
        <section className="border-b border-navy/10">
          <div className="mx-auto max-w-3xl px-5 py-20 sm:py-24">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-violet">
              Notes
            </p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">
              불편함 노트
            </h1>
            <p className="mt-5 max-w-xl leading-relaxed text-navy/60">
              사람들이 참고 지나가는 불편함을 찾아 기록합니다. 문제가 실제로
              얼마나 큰지 확인하고, 기존 해법이 어디서 멈췄는지 짚고, 우리라면
              어떻게 풀지까지 적어둡니다. 여기 적힌 문제가 다음 제품이 됩니다.
            </p>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-3xl px-5 py-16">
            {posts.length === 0 ? (
              <p className="text-navy/50">첫 글을 준비하고 있습니다.</p>
            ) : (
              <ul className="divide-y divide-navy/10">
                {posts.map((p) => (
                  <li key={p.slug}>
                    <a
                      href={`/blog/${p.slug}/`}
                      className="group block py-8 transition"
                    >
                      <div className="flex items-center gap-3 text-xs">
                        <span className="rounded-full bg-periwinkle/30 px-2.5 py-1 font-semibold text-navy/80">
                          {p.category}
                        </span>
                        <time dateTime={p.date} className="text-navy/45">
                          {formatDate(p.date)}
                        </time>
                      </div>
                      <h2 className="mt-3 text-xl font-bold leading-snug tracking-tight transition group-hover:text-violet sm:text-2xl">
                        {p.title}
                      </h2>
                      <p className="mt-2 leading-relaxed text-navy/60">
                        {p.summary}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
