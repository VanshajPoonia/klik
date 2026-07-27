import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { OrganizerFeatures } from "@/components/marketing/organizer-features";
import { Pricing } from "@/components/marketing/pricing";
import { UseCases } from "@/components/marketing/use-cases";
import { ConsentNote } from "@/components/marketing/consent-note";
import { FinalCta } from "@/components/marketing/final-cta";
import { Footer } from "@/components/marketing/footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <OrganizerFeatures />
        <Pricing />
        <UseCases />
        <ConsentNote />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
