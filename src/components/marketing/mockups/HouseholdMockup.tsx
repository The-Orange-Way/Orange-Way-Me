import { Chrome } from "./Chrome";

export function HouseholdMockup() {
  return (
    <Chrome>
      <img
        src="/marketing/mockup-household.webp"
        alt="OrangeWay household transactions view showing shared and private spending visibility"
        width={1280}
        height={896}
        loading="lazy"
        className="block w-full h-auto"
        draggable={false}
      />
    </Chrome>
  );
}

export default HouseholdMockup;
