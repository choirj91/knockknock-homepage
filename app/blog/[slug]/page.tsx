import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getAllPosts, getPost, formatDate } from "@/lib/blog";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.summary,
    alternates: { canonical: `/blog/${post.slug}/` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.summary,
      url: `https://knockknock.company/blog/${post.slug}/`,
      publishedTime: post.date,
    },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Organization", name: "낰낰컴퍼니" },
    publisher: { "@type": "Organization", name: "낰낰컴퍼니" },
    mainEntityOfPage: `https://knockknock.company/blog/${post.slug}/`,
  };

  return (
    <>
      <Header />
      <main>
        <article>
          <div className="border-b border-navy/10">
            <div className="mx-auto max-w-2xl px-5 py-16 sm:py-20">
              <a
                href="/blog/"
                className="text-sm font-medium text-navy/50 transition hover:text-violet"
              >
                ← 불편함 노트
              </a>
              <div className="mt-6 flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded-full bg-periwinkle/30 px-2.5 py-1 font-semibold text-navy/80">
                  {post.category}
                </span>
                <time dateTime={post.date} className="text-navy/45">
                  {formatDate(post.date)}
                </time>
                <span className="text-navy/45">
                  읽는 데 {post.readingMinutes}분
                </span>
              </div>
              <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                {post.title}
              </h1>
              <p className="mt-5 leading-relaxed text-navy/60">
                {post.summary}
              </p>
            </div>
          </div>

          <div className="mx-auto max-w-2xl px-5 py-14">
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: post.html }}
            />

            {post.tags.length > 0 && (
              <div className="mt-14 flex flex-wrap gap-1.5 border-t border-navy/10 pt-8">
                {post.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-navy/10 px-2.5 py-1 text-xs font-medium text-navy/60"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <aside className="mt-10 rounded-2xl bg-white p-7 ring-1 ring-navy/10">
              <p className="text-sm font-bold tracking-tight">
                이 문제, 겪고 계신가요?
              </p>
              <p className="mt-2 text-sm leading-relaxed text-navy/60">
                낰낰컴퍼니는 여기 적은 불편함을 실제 제품으로 풀고 있습니다.
                비슷한 불편을 겪고 계시거나 더 나은 해법이 떠오르셨다면{" "}
                <a
                  href="mailto:admin@knockknock.company"
                  className="font-medium text-violet underline underline-offset-4"
                >
                  admin@knockknock.company
                </a>
                로 알려주세요.
              </p>
            </aside>
          </div>
        </article>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
