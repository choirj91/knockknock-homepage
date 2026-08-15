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
  },
  {
    slug: "coming-soon",
    name: "다음 제품",
    nameEn: "Coming Soon",
    tagline: "다음 불편함을 찾고 있습니다",
    description:
      "일상의 불편함을 편리함으로 바꾸는 다음 제품을 준비하고 있습니다. 곧 찾아뵙겠습니다.",
    status: "coming-soon",
    tags: ["준비 중"],
    cover: "from-periwinkle to-violet",
    monogram: "??",
  },
];
