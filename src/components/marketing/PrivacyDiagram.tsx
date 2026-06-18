const C = {
  burnt: "#E2632E",
  brown: "#3A2012",
  cream: "#FBF6EF",
};
const fontDisplay = `"Fraunces", ui-serif, Georgia, serif`;

export function PrivacyDiagram() {
  return (
    <section className="px-6 py-10 md:py-16" style={{ background: C.cream }}>
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.burnt }}>
            {"How privacy works here"}
          </p>
          <h2
            style={{ fontFamily: fontDisplay, color: C.brown, lineHeight: 1.05 }}
            className="mt-3 text-balance text-3xl font-bold tracking-tight md:text-4xl"
          >
            {"Your password is the only key."}{" "}
            <span style={{ color: C.burnt, fontStyle: "italic" }}>
              {"Without it, all we see is mumbo jumbo."}
            </span>
          </h2>
        </div>

        <img
          src="/marketing/privacy-diagram.webp"
          alt="How OrangeWay protects your data: your device, encrypted on your device, we only see scrambled data, only you can unlock it."
          width={1600}
          height={512}
          loading="lazy"
          draggable={false}
          className="mt-8 hidden md:block w-full h-auto"
        />
        <img
          src="/marketing/privacy-diagram-mobile.webp"
          alt="How OrangeWay protects your data: your device, encrypted on your device, we only see scrambled data, only you can unlock it."
          width={608}
          height={1408}
          loading="lazy"
          draggable={false}
          className="mt-8 block md:hidden w-full h-auto mx-auto max-w-sm"
        />
      </div>
    </section>
  );
}

export default PrivacyDiagram;
