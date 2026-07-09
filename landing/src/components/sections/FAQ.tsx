"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  "offline",
  "printers",
  "import",
  "security",
  "mobile",
  "formats",
  "customize",
  "migrate",
];

export function FAQ() {
  const t = useTranslations("FAQ");

  return (
    <section id="faq" className="container py-16 md:py-24 bg-muted/50">
      <motion.div
        className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center mb-12"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="font-bold text-3xl leading-[1.1] sm:text-3xl md:text-5xl">
          {t("title")}
        </h2>
        <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-lg sm:leading-7">
          {t("subtitle")}
        </p>
      </motion.div>

      <motion.div
        className="max-w-3xl mx-auto"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq) => (
            <AccordionItem key={faq} value={faq}>
              <AccordionTrigger className="text-left hover:text-primary">
                {t(`questions.${faq}.question`)}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {t(`questions.${faq}.answer`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </motion.div>
    </section>
  );
}
