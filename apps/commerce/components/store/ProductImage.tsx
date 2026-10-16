import { initials } from "./format";

/** The product's picture, or a neutral tile with its initials. */
export default function ProductImage({ name, src, large = false }: { name: string; src: string; large?: boolean }) {
  const cls = large ? "shop-img shop-img-large" : "shop-img";
  if (src && /^(https?:\/\/|\/)/.test(src)) {
    // Product pictures can live on any host, so a plain img rather than next/image.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cls} src={src} alt={name} loading={large ? "eager" : "lazy"} />;
  }
  return (
    <div className={`${cls} shop-img-blank`} role="img" aria-label={name}>
      <span>{initials(name)}</span>
    </div>
  );
}
