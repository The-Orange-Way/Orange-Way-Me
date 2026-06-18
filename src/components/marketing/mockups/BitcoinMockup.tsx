import { Chrome } from "./Chrome";

export function BitcoinMockup() {
  return (
    <Chrome>
      <img
        src="/marketing/mockup-bitcoin.webp"
        alt="OrangeWay Bitcoin holdings view with cost basis, price chart, and DCA transactions"
        width={1280}
        height={896}
        loading="lazy"
        className="block w-full h-auto"
        draggable={false}
      />
    </Chrome>
  );
}

export default BitcoinMockup;
