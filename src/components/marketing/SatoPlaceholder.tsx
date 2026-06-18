import heroPig from "@/assets/orange-way/hero-pig.png";

export function SatoPlaceholder({ size = 320 }: { size?: number }) {
  return (
    <img
      src={heroPig}
      alt="Sato, the Orange Way piggy bank mascot"
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

export default SatoPlaceholder;
