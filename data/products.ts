export type ProductStatus = "live" | "beta" | "coming-soon";

export interface Product {
  /** URL-safe identifier */
  slug: string;
  name: string;
  nameEn: string;
  tagline: string;
  description: string;
  url?: string;
  status: ProductStatus;
  tags: string[];
  /** Tailwind gradient classes for the card cover */
  cover: string;
  /** Short monogram rendered on the card cover */
  monogram: string;
  stats?: { label: string; value: string }[];
  /** Related reading hosted on the product site */
  links?: { label: string; url: string }[];
}

export const products: Product[] = [
  {
    slug: "tester-match",
    name: "테스터 매치",
    nameEn: "Tester Match",
    tagline: "Google Play 비공개 테스트, 품앗이로 해결",
    description:
      "Google Play 출시 요건인 '테스터 12명 · 14일 연속 테스트'를 같은 처지의 인디 안드로이드 개발자끼리 서로 테스터가 되어주는 품앗이로 해결하는 무료 매칭 플랫폼입니다.",
    url: "https://tester-match.knockknock.company",
    status: "live",
    tags: ["Google Play", "인디 개발자", "무료"],
    cover: "from-violet to-navy",
    monogram: "TM",
    stats: [
      { label: "사용자", value: "1,000+" },
      { label: "등록 앱", value: "950+" },
      { label: "활성 매칭", value: "150+" },
    ],
    links: [
      {
        label: "서비스 소개",
        url: "https://tester-match.knockknock.company/about",
      },
      {
        label: "출시 가이드",
        url: "https://tester-match.knockknock.company/guide",
      },
      {
        label: "운영 지표",
        url: "https://tester-match.knockknock.company/stats",
      },
    ],
  },
];
