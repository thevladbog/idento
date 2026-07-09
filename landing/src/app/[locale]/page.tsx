import { Hero } from "@/components/sections/Hero";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { UseCases } from "@/components/sections/UseCases";
import { Comparison } from "@/components/sections/Comparison";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { Download } from "@/components/sections/Download";
import { FinalCTA } from "@/components/sections/FinalCTA";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <Hero />
      <Features />
      <HowItWorks />
      <UseCases />
      <Comparison />
      <Pricing />
      <FAQ />
      <Download />
      <FinalCTA />
    </div>
  );
}
