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
import { DonatePage } from "@/components/public/donate";
import { VolunteerPage } from "@/components/public/volunteer";
import { AboutPage } from "@/components/public/about";
import { ImpactPage } from "@/components/public/impact";
import { ContactPage } from "@/components/public/contact";
import { LoginPage, RegisterPage } from "@/components/public/auth-pages";
import { ProfilePage } from "@/components/public/profile-page";
import { Compass } from "lucide-react";

/**
 * PublicSite — the single hash-routed public website.
 * Routes: / · /about · /campaigns · /campaigns/:slug · /green-corridor
 *         /donate · /volunteer · /contact · /impact · /login · /register · /profile
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

  if (campaignMatch) {
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
      case "/profile":
        page = <ProfilePage key={route.key} />;
        break;
      default:
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

  return <PublicLayout path={path}>{page}</PublicLayout>;
}
