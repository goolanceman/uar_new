"use client";

import * as React from "react";
import { useRoute, matchPath } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { PublicLayout } from "@/components/public/layout";
import { EmptyState } from "@/components/public/shared";
import { HomePage } from "@/components/public/home";
import { CampaignsPage } from "@/components/public/campaigns";
import { CampaignDetailPage } from "@/components/public/campaign-detail";
import { GreenCorridorPage } from "@/components/public/green-corridor";
import { FoodSecurityPage } from "@/components/public/food-security";
import { FoodApplyPage } from "@/components/public/food-apply";
import { DonatePage } from "@/components/public/donate";
import { VolunteerPage } from "@/components/public/volunteer";
import { AboutPage } from "@/components/public/about";
import { ImpactPage } from "@/components/public/impact";
import { ContactPage } from "@/components/public/contact";
import { LoginPage, RegisterPage, ForgotPasswordPage } from "@/components/public/auth-pages";
import { ProfilePage } from "@/components/public/profile-page";
import { PolicyPage } from "@/components/public/policies";
import {
  CertificateVerifyPage,
  ReceiptVerifyPage,
  VerifyHubPage,
} from "@/components/public/verify";
import { Compass } from "lucide-react";

/** Trust & Legal policy routes rendered by the single PolicyPage component. */
const POLICY_ROUTES: Record<string, string> = {
  "/privacy": "privacy",
  "/terms": "terms",
  "/refunds": "refunds",
  "/tax-exemption": "tax-exemption",
  "/faq": "faq",
};

/**
 * PublicSite — the single hash-routed public website.
 * Routes: / · /about · /campaigns · /campaigns/:slug · /green-corridor
 *         /programs/food-security · /food-assistance/apply
 *         /donate · /volunteer · /contact · /impact · /login · /register
 *         /forgot-password · /profile · /verify · /verify/certificate/:code
 *         /verify/receipt/:number · /privacy · /terms · /refunds
 *         /tax-exemption · /faq
 */
export function PublicSite() {
  const route = useRoute();
  const path = route.path.split("?")[0] || "/";
  const segments = React.useMemo(
    () => path.split("/").filter(Boolean),
    [path]
  );

  let page: React.ReactNode;

  const campaignMatch = matchPath("/campaigns/:slug", segments);
  const certificateMatch = matchPath("/verify/certificate/:code", segments);
  const receiptMatch = matchPath("/verify/receipt/:number", segments);

  if (certificateMatch) {
    page = <CertificateVerifyPage key={certificateMatch.code} code={certificateMatch.code} />;
  } else if (receiptMatch) {
    page = <ReceiptVerifyPage key={receiptMatch.number} number={receiptMatch.number} />;
  } else if (campaignMatch) {
    page = <CampaignDetailPage key={campaignMatch.slug} slug={campaignMatch.slug} />;
  } else {
    switch (path) {
      case "/":
        page = <HomePage key={route.key} />;
        break;
      case "/about":
        page = <AboutPage key={route.key} />;
        break;
      case "/campaigns":
        page = <CampaignsPage key={route.key} />;
        break;
      case "/green-corridor":
        page = <GreenCorridorPage key={route.key} />;
        break;
      case "/programs/food-security":
        page = <FoodSecurityPage key={route.key} />;
        break;
      case "/food-assistance/apply":
        page = <FoodApplyPage key={route.key} />;
        break;
      case "/donate":
        page = <DonatePage key={route.key} />;
        break;
      case "/volunteer":
        page = <VolunteerPage key={route.key} />;
        break;
      case "/contact":
        page = <ContactPage key={route.key} />;
        break;
      case "/impact":
        page = <ImpactPage key={route.key} />;
        break;
      case "/login":
        page = <LoginPage key={route.key} />;
        break;
      case "/register":
        page = <RegisterPage key={route.key} />;
        break;
      case "/forgot-password":
        page = <ForgotPasswordPage key={route.key} />;
        break;
      case "/verify":
        page = <VerifyHubPage key={route.key} />;
        break;
      case "/profile":
        page = <ProfilePage key={route.key} />;
        break;
      default: {
        const policySlug = POLICY_ROUTES[path];
        if (policySlug) {
          page = <PolicyPage key={policySlug} slug={policySlug} />;
          break;
        }
        page = (
          <EmptyState
            icon={Compass}
            title="Page not found"
            hint="The road less travelled led nowhere this time. Let's get you back to the programmes."
            action={
              <Button className="bg-emerald-600 hover:bg-emerald-700" asChild>
                <a href="#/">Back to home</a>
              </Button>
            }
          />
        );
        break;
      }
    }
  }

  return <PublicLayout path={path}>{page}</PublicLayout>;
}
