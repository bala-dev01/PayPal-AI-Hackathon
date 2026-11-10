import { SiteNav } from "@/components/owner/site-nav";
import { Hero } from "@/components/owner/landing/Hero";
import { MoneySplit } from "@/components/owner/landing/MoneySplit";
import { Story } from "@/components/owner/landing/Story";
import { Closer, Roles, Rules } from "@/components/owner/landing/Sections";

export default function Home() {
  return (
    <>
      <SiteNav current="home" />
      <Hero />
      <MoneySplit />
      <Story />
      <Roles />
      <Rules />
      <Closer />
    </>
  );
}
