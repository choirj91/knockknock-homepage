import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://knockknock.company"),
  title: {
    default: "낰낰컴퍼니 — 똑똑한 회사",
    template: "%s | 낰낰컴퍼니",
  },
  description:
    "낰낰컴퍼니(Knock Knock Company)는 일상의 불편함을 편리함으로 바꾸는 소프트웨어를 만듭니다. 똑똑, 문을 두드리면 편리한 삶이 열립니다.",
  keywords: [
    "낰낰컴퍼니",
    "Knock Knock Company",
    "테스터 매치",
    "Tester Match",
    "소프트웨어",
  ],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "https://knockknock.company",
    siteName: "낰낰컴퍼니",
    title: "낰낰컴퍼니 — 똑똑한 회사",
    description:
      "일상의 불편함을 편리함으로 바꾸는 소프트웨어를 만듭니다.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
