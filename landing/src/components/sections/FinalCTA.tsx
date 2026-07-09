"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function FinalCTA() {
  const t = useTranslations("FinalCTA");

  const trustIndicators = ["noCredit", "cancel", "support"];

  return (
    <section className="relative overflow-hidden py-20 md:py-32">
      {/* Bold Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-primary/70" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent" />

      {/* Animated Background Shapes */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="container relative z-10">
        <motion.div
          className="mx-auto max-w-4xl text-center space-y-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          {/* Headline */}
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight">
            {t("title")}
          </h2>

          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-white/90 max-w-2xl mx-auto">
            {t("subtitle")}
          </p>

          {/* Trust Indicators */}
          <div className="flex flex-wrap justify-center gap-6 text-white/90">
            {trustIndicators.map((indicator) => (
              <div key={indicator} className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">{t(`trust.${indicator}`)}</span>
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <motion.div
            className="pt-4"
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Button
              size="lg"
              variant="secondary"
              asChild
              className="text-lg px-8 py-6 h-auto shadow-2xl hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              <Link href="#signup" className="flex items-center gap-2">
                {t("cta")}
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
          </motion.div>

          {/* Additional Info */}
          <p className="text-sm text-white/70 pt-4">{t("additional")}</p>
        </motion.div>
      </div>
    </section>
  );
}
