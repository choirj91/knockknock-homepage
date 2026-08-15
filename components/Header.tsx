import Logo from "./Logo";

const navItems = [
  { href: "#products", label: "제품" },
  { href: "#about", label: "회사 소개" },
  { href: "#contact", label: "문의" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy/5 bg-mist/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#" className="flex items-center gap-3">
          <Logo />
          <span className="text-[17px] font-extrabold tracking-tight">
            낰낰컴퍼니
          </span>
        </a>
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-navy/60 transition hover:text-navy"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
