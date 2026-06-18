import { Chrome } from "./Chrome";

export function BudgetMockup() {
  return (
    <Chrome>
      <img
        src="/marketing/mockup-budget.webp"
        alt="OrangeWay budget view: October budget showing five categories with progress bars"
        width={1280}
        height={896}
        loading="lazy"
        className="block w-full h-auto"
        draggable={false}
      />
    </Chrome>
  );
}

export default BudgetMockup;
