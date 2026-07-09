import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";

export default function PricingPage() {
  return (
    <div className="flex flex-col">
      <div className="container py-16 md:py-24 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4">
          Choose Your Plan
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Simple, transparent pricing for events of all sizes
        </p>
      </div>
      <Pricing />
      <FAQ />
      <FinalCTA />
    </div>
  );
}
