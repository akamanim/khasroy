import type { ReactNode } from "react";
import { StudioInteractions } from "./studio-interactions";
import { StudioMagic } from "./studio-magic";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <StudioMagic />
      <StudioInteractions />
    </>
  );
}
