import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="bg-navy text-mist">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex items-center gap-3">
              <Logo tile="rgba(247, 248, 252, 0.08)" />
              <span className="text-lg font-extrabold tracking-tight">
                낰낰컴퍼니
              </span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-periwinkle">
              똑똑한 회사, Knock Knock Company.
              <br />
              일상의 불편함을 편리함으로 바꿉니다.
            </p>
          </div>
          <div className="text-sm leading-loose text-periwinkle">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-mist/60">
              Company
            </p>
            <p>상호: 낰낰컴퍼니 (Knock Knock Company)</p>
            <p>사업자등록번호: 441-20-02677</p>
            <p>
              이메일:{" "}
              <a
                href="mailto:admin@knockknock.company"
                className="underline underline-offset-4 transition hover:text-mist"
              >
                admin@knockknock.company
              </a>
            </p>
          </div>
        </div>
        <p className="mt-12 border-t border-mist/10 pt-6 text-xs text-periwinkle/60">
          © {new Date().getFullYear()} Knock Knock Company. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}
