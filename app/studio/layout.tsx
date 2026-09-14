import type { ReactNode } from "react";
import { StudioMagic } from "./studio-magic";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <StudioMagic />
    </>
  );
}
