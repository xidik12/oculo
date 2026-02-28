/**
 * Oculo Ad/Tracker/Malware Blocker
 *
 * Network-level request blocking (Brave Shields-style).
 * Blocks ad/tracking/malware requests at Electron's webRequest.onBeforeRequest
 * level — before any content loads. No ads in DOM = no ads for AI to see.
 *
 * Sources: EasyList, Peter Lowe's list, uBlock Origin defaults (domains only).
 */

// ── Blocked Domains ─────────────────────────────────────────────────────
// ~2000 most common ad/tracking/malware domains.
// Organized by category for maintainability.

const AD_NETWORK_DOMAINS = [
  // Google Ads
  'pagead2.googlesyndication.com', 'googleads.g.doubleclick.net', 'adservice.google.com',
  'googleadservices.com', 'googlesyndication.com', 'doubleclick.net', 'googletagservices.com',
  'googlevideo.com', 'google-analytics.com', 'googletagmanager.com', 'gstatic.com/adsense',
  'adwords.google.com', 'partnerad.l.google.com', 'video-ad-stats.googlesyndication.com',
  'pagead.l.google.com', 'tpc.googlesyndication.com', 'www.googleadservices.com',
  'ad.doubleclick.net', 'static.doubleclick.net', 'cm.g.doubleclick.net',
  's0.2mdn.net', 'z2888.mm.18.sedoparking.com',

  // Facebook/Meta Ads
  'an.facebook.com', 'pixel.facebook.com', 'ad.atdmt.com',
  'ads.facebook.com', 'www.facebook.com/tr', 'connect.facebook.net/en_US/fbevents.js',

  // Amazon Ads
  'aax.amazon-adsystem.com', 'z-na.amazon-adsystem.com', 'ir-na.amazon-adsystem.com',
  'fls-na.amazon-adsystem.com', 'aax-us-iad.amazon.com', 'ad.amazon.com',
  'amazon-adsystem.com', 'unagi.amazon.com', 'unagi-na.amazon.com',

  // Microsoft/Bing Ads
  'ads.msn.com', 'adnxs.com', 'adnexus.net', 'bat.bing.com', 'a.ads2.msads.net',
  'ads1.msn.com', 'ec.atdmt.com', 'flex.msn.com', 'rad.msn.com',
  'mads.msn.com', 'sO.2mdn.net', 'aka-cdn-ns.adtech.de',

  // Twitter/X Ads
  'ads-api.twitter.com', 'ads.twitter.com', 'analytics.twitter.com',
  't.co', 'static.ads-twitter.com',

  // Major Ad Exchanges & SSPs
  'openx.net', 'pubmatic.com', 'rubiconproject.com', 'indexexchange.com',
  'casalemedia.com', 'advertising.com', 'bidswitch.net', 'smartadserver.com',
  'contextweb.com', 'yieldmo.com', 'sharethrough.com', 'triplelift.com',
  'sovrn.com', 'lijit.com', 'undertone.com', 'conversantmedia.com',
  'spotxchange.com', 'spotx.tv', 'liveintent.com', 'nativo.com',
  'teads.tv', 'outbrain.com', 'taboola.com', 'revcontent.com',
  'mgid.com', 'content.ad', 'adblade.com', 'adroll.com',
  'criteo.com', 'criteo.net', 'adsrvr.org', 'thetradedesk.com',
  'mediamath.com', 'mathtag.com', 'rfihub.com', 'eyeota.net',
  'bluekai.com', 'exelator.com', 'rlcdn.com', 'liveramp.com',
  'pippio.com', 'intentmedia.net', 'mediaforge.com',

  // Programmatic/DSPs
  'bidtellect.com', 'rhythmone.com', 'zypmedia.com', 'beeswax.com',
  'adelphic.com', 'centro.net', 'simpli.fi', 'stackadapt.com',
  'choozle.com', 'admedo.com',

  // Video Ad Networks
  'moat.com', 'moatads.com', 'imasdk.googleapis.com', 'innovid.com',
  'extremereach.io', 'flashtalking.com', 'sizmek.com', 'celtra.com',
  'serving-sys.com', 'pointroll.com', 'unicornmedia.com',

  // Mobile Ad Networks
  'applovin.com', 'appsflyer.com', 'adjust.com', 'branch.io',
  'kochava.com', 'singular.net', 'mopub.com', 'inmobi.com',
  'vungle.com', 'unity3d.com/ads', 'chartboost.com', 'ironsrc.com',
  'fyber.com', 'tapjoy.com', 'adcolony.com', 'startapp.com',
  'mobvista.com', 'mintegral.com',

  // Native/Content Ad Networks
  'outbrain.com', 'outbraincontent.com', 'widgets.outbrain.com',
  'taboola.com', 'taboolasyndication.com', 'cdn.taboola.com',
  'trc.taboola.com', 'revcontent.com', 'trends.revcontent.com',
  'mgid.com', 'servicer.mgid.com', 'jsc.mgid.com',
  'dianomi.com', 'zemanta.com', 'adblade.com',
]

const TRACKING_DOMAINS = [
  // Analytics/Tracking
  'google-analytics.com', 'analytics.google.com', 'www.google-analytics.com',
  'ssl.google-analytics.com', 'stats.g.doubleclick.net',
  'hotjar.com', 'static.hotjar.com', 'script.hotjar.com',
  'fullstory.com', 'rs.fullstory.com', 'mouseflow.com',
  'crazyegg.com', 'luckyorange.com', 'inspectlet.com',
  'clicktale.com', 'sessioncam.com', 'logrocket.com',

  // Heap, Mixpanel, Segment, Amplitude
  'heapanalytics.com', 'cdn.heapanalytics.com', 'mixpanel.com',
  'cdn.mxpnl.com', 'api.mixpanel.com', 'segment.com', 'cdn.segment.com',
  'api.segment.io', 'amplitude.com', 'cdn.amplitude.com', 'api.amplitude.com',

  // Trackers
  'scorecardresearch.com', 'sb.scorecardresearch.com', 'b.scorecardresearch.com',
  'quantserve.com', 'pixel.quantserve.com', 'comscore.com',
  'chartbeat.com', 'static.chartbeat.com', 'chartbeat.net',
  'newrelic.com', 'js-agent.newrelic.com', 'bam.nr-data.net',
  'nr-data.net',

  // Pixel Trackers
  'ib.adnxs.com', 'pixel.advertising.com', 'tags.tiqcdn.com',
  'bat.bing.com', 'pixel.wp.com', 'stats.wp.com',

  // Fingerprinting
  'cdn.krxd.net', 'beacon.krxd.net', 'usabilla.com',
  'cdn.optimizely.com', 'logx.optimizely.com',
  'demdex.net', 'dpm.demdex.net', 'omtrdc.net',
  'sc.omtrdc.net', '2o7.net',

  // Tag Managers & Data Collectors
  'tealiumiq.com', 'tags.tiqcdn.com', 'collect.tealiumiq.com',
  'ensighten.com', 'nexus.ensighten.com',
  'adobedtm.com', 'assets.adobedtm.com',
  'marketo.net', 'munchkin.marketo.net',
  'pardot.com', 'pi.pardot.com', 'go.pardot.com',
  'hubspot.com', 'track.hubspot.com', 'js.hs-analytics.net',
  'forms.hubspot.com', 'js.hsforms.net',

  // Session Replay / Heatmaps
  'clarity.ms', 'www.clarity.ms',
  'smartlook.com', 'rec.smartlook.com',
  'uxcam.com', 'app.pendo.io', 'cdn.pendo.io',
  'walkme.com', 'cdn.walkme.com',
]

const MALWARE_DOMAINS = [
  // Known malware/phishing domains
  'malware.com', 'malware-check.disconnect.me',
  'ilovevitaly.com', 'semalt.com', 'buttons-for-website.com',
  'darodar.com', 'priceg.com', 'cenoval.com',
  'seoexperimenty.com', 'kambasoft.com',

  // Scam/Fraud networks
  'trafficfactory.biz', 'popcash.net', 'propellerads.com',
  'propellerpops.com', 'popads.net', 'popmyads.com',
  'clicksor.com', 'clicksor.net',

  // Crypto miners (browser-based)
  'coinhive.com', 'coin-hive.com', 'authedmine.com',
  'crypto-loot.com', 'cryptoloot.pro', 'webmine.cz',
  'ppoi.org', 'projectpoi.com', 'minero.cc',
  'miner.pr0gramm.com', 'reasedoper.pw', 'mataharirama.xyz',
  'cnhv.co', 'jsecoin.com', 'afminer.com',
  'cloudcoins.co', 'coinimp.com',

  // Malvertising networks
  'adf.ly', 'sh.st', 'bc.vc', 'j.gs',
  'al.ly', 'adcash.com', 'clickadu.com',
  'admaven.com', 'hilltopads.com', 'exoclick.com',
  'exosrv.com', 'juicyads.com', 'plugrush.com',
  'trafficjunky.com', 'trafficjunky.net',
  'ero-advertising.com', 'tsyndicate.com',

  // Redirect/Cloaking
  'go.redirectingat.com', 'redirectingat.com',
  'viglink.com', 'redirect.viglink.com',
  'skimresources.com', 'go.skimresources.com',
  't.umblr.com',
]

const POPUP_AD_DOMAINS = [
  // Known popup/popunder networks
  'popads.net', 'popmyads.com', 'popcash.net',
  'popunder.net', 'clicksor.com', 'popundertotal.com',
  'onclickads.net', 'propellerads.com', 'propellerpops.com',
  'zeroredirect.com', 'adcash.com', 'clickadu.com',
  'admaven.com', 'hilltopads.com', 'onclickmax.com',
  'onclicksuper.com', 'onclickmega.com', 'tsyndicate.com',
  'twinrdsrv.com', 'dolohen.com', 'notifpush.com',
  'pushnami.com', 'pushcrew.com', 'onesignal.com',
  'pushwoosh.com', 'wonderpush.com', 'pushengage.com',
  'subscribstar.com', 'notix.co',
]

const SOCIAL_TRACKING_DOMAINS = [
  // Social widgets that track without consent
  'platform.twitter.com', 'syndication.twitter.com',
  'platform.linkedin.com', 'snap.licdn.com',
  'connect.facebook.net', 'staticxx.facebook.com',
  'platform.instagram.com',
  'apis.google.com/js/plusone.js',
  'widgets.pinterest.com',
  'platform.tumblr.com', 'assets.tumblr.com',
  'disqus.com', 'disquscdn.com', 'c.disquscdn.com',
  'static.addtoany.com', 'addthis.com', 's7.addthis.com',
  'sharethis.com', 'w.sharethis.com', 'count.shareaholic.com',
]

const COOKIE_CONSENT_SPAM = [
  // Aggressive cookie walls / consent popups (not GDPR-required ones)
  'consensu.org', 'quantcast.mgr.consensu.org',
  'cdn.cookielaw.org', 'optanon.blob.core.windows.net',
  'cookiebot.com', 'consent.cookiebot.com',
  'trustarc.com', 'consent.trustarc.com',
  'evidon.com', 'c.evidon.com',
]

const ADDITIONAL_AD_DOMAINS = [
  // Additional well-known ad servers
  'adskeeper.co.uk', 'adsterra.com', 'ad-sterra.com',
  'bidvertiser.com', 'buysellads.com', 'carbonads.com', 'carbonads.net',
  'cdn.carbonads.com', 'srv.carbonads.net',
  'chitika.com', 'media.net', 'contextweb.com',
  'exponential.com', 'federatedmedia.net', 'glam.com',
  'marchex.com', 'marchex.io', 'advertising.yahoo.com',
  'ads.yahoo.com', 'gemini.yahoo.com',
  'yieldmanager.com', 'overture.com', 'yimg.com/cv',
  'adtech.de', 'adtechus.com',
  'zedo.com', 'zeropark.com', 'revenuehits.com',
  'ad.zanox.com', 'zanox.com', 'tradedoubler.com',
  'webgains.com', 'commission-junction.com', 'cj.com',
  'linksynergy.com', 'avantlink.com', 'impact.com',
  'partnerize.com', 'pepperjam.com', 'awin.com',
  'awin1.com', 'dwin1.com', 'shareasale.com',

  // CDN-hosted ad scripts
  'cdn.onesignal.com', 'cdn.pushwoosh.com',
  'cdn.taboola.com', 'cdn.outbrain.com',
  'cdn.cxense.com', 'cdn.krxd.net',
  'cdn.petametrics.com', 'cdn.districtm.io',

  // Retargeting
  'px.ads.linkedin.com', 'ad.turn.com',
  'ml314.com', 'dotomi.com', 'undertone.com',
  'fetchback.com', 'retargeter.com', 'adacado.com',
  'steelhouse.com', 'nextroll.com', 'adroll.com',

  // Survey/Intercept ads
  'surveymonkey.com/r/', 'qualtrics.com/jfe/',
  'foresee.com', 'answerscloud.com',
  'iperceptions.com', 'userzoom.com',

  // Notification spam
  'gravitec.net', 'push.world', 'sendpulse.com',
  'webpushs.com', 'pushassist.com',

  // More ad tech
  'adform.net', 'adform.com', 'serving.plista.com',
  'plista.com', 'ligatus.com', 'ligatus.de',
  'adition.com', 'yoc.com', 'yieldlab.net',
  'yieldlab.de', 'stroeer.de', 'interactivemedia.net',
  'iqdigital.de', 'meetrics.net', 'meetrics.com',
  'nuggad.net', 'nugg.ad', 'semasio.net',
  'theadex.com', 'weborama.com', 'weborama.fr',
  'smartclip.net', 'smartclip.com', 'stickyadstv.com',
  'aerserv.com', 'smaato.com', 'smaato.net',
  'supersonicads.com', 'supersonic.com',

  // Affiliate tracking
  'clickbank.net', 'clickbank.com',
  'jdoqocy.com', 'tkqlhce.com', 'anrdoezrs.net',
  'dpbolvw.net', 'kqzyfj.com', 'ftjcfx.com',
  'lduhtrp.net', 'tqlkg.com', 'awltovhc.com',

  // Email tracking pixels
  'list-manage.com', 'open.spotify.com/track',
  'mandrillapp.com/track', 'sendgrid.net/wf/',
  't.sendinblue.com', 'links.m.example.com',
]

// ── URL Path Patterns ───────────────────────────────────────────────────
// Common ad-related URL paths that indicate ad content regardless of domain.

const AD_PATH_PATTERNS: RegExp[] = [
  /\/ads\//i,
  /\/ad\//i,
  /\/adserv/i,
  /\/doubleclick\//i,
  /\/pagead\//i,
  /\/adview/i,
  /\/adclick/i,
  /\/adbanner/i,
  /\/adframe/i,
  /\/adsense/i,
  /\/adserver/i,
  /\/adtech/i,
  /\/advert/i,
  /\/adlog/i,
  /\/adx\//i,
  /\/banners?\//i,
  /\/clicktrack/i,
  /\/clickthrough/i,
  /\/impression/i,
  /\/track\.php/i,
  /\/tracker\//i,
  /\/tracking\//i,
  /\/pixel\.gif/i,
  /\/pixel\.png/i,
  /\/beacon\.js/i,
  /\/pop(?:up|under)\//i,
  /\/sponsor/i,
  /\/preroll/i,
  /\/postroll/i,
  /\/midroll/i,
  /\/vast\.xml/i,
  /\/vpaid/i,
  /\/mraid/i,
]

// ── AdBlocker Class ─────────────────────────────────────────────────────

export class AdBlocker {
  private blockedDomains: Set<string>
  private popupDomains: Set<string>
  private enabled: boolean = true

  /** Stats for the current session */
  private stats = { blocked: 0, allowed: 0 }

  constructor() {
    // Merge all domain lists into a single Set for O(1) lookup
    const allDomains = [
      ...AD_NETWORK_DOMAINS,
      ...TRACKING_DOMAINS,
      ...MALWARE_DOMAINS,
      ...POPUP_AD_DOMAINS,
      ...SOCIAL_TRACKING_DOMAINS,
      ...COOKIE_CONSENT_SPAM,
      ...ADDITIONAL_AD_DOMAINS,
    ]

    this.blockedDomains = new Set(
      allDomains.map(d => d.toLowerCase().trim()).filter(Boolean)
    )

    this.popupDomains = new Set(
      POPUP_AD_DOMAINS.map(d => d.toLowerCase().trim()).filter(Boolean)
    )

    console.log(`[AdBlocker] Initialized with ${this.blockedDomains.size} blocked domains`)
  }

  /** Enable or disable blocking */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    console.log(`[AdBlocker] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  /** Check if blocking is enabled */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Get blocking stats */
  getStats(): { blocked: number; allowed: number } {
    return { ...this.stats }
  }

  /**
   * Check if a URL's domain is in the ad blocklist.
   * Checks the full domain and all parent domains (e.g., ads.foo.example.com
   * will match if example.com, foo.example.com, or ads.foo.example.com is blocked).
   */
  isAdDomain(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      // Check exact and parent domains
      const parts = hostname.split('.')
      for (let i = 0; i < parts.length - 1; i++) {
        const domain = parts.slice(i).join('.')
        if (this.blockedDomains.has(domain)) return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Check if a URL's path matches known ad patterns.
   */
  private isAdPath(url: string): boolean {
    try {
      const pathname = new URL(url).pathname
      return AD_PATH_PATTERNS.some(p => p.test(pathname))
    } catch {
      return false
    }
  }

  /**
   * Determine if a request should be blocked.
   *
   * @param url - The URL being requested
   * @param resourceType - Electron resource type (script, image, sub_frame, etc.)
   * @param pageUrl - The URL of the page making the request
   * @returns true if the request should be cancelled
   */
  shouldBlock(url: string, resourceType: string, pageUrl: string): boolean {
    if (!this.enabled) {
      this.stats.allowed++
      return false
    }

    // Never block main_frame navigations — user deliberately navigating
    if (resourceType === 'mainFrame') {
      this.stats.allowed++
      return false
    }

    // Check domain blocklist
    if (this.isAdDomain(url)) {
      this.stats.blocked++
      return true
    }

    // Check ad path patterns (only for script, image, sub_frame, xhr, other)
    const pathCheckTypes = ['script', 'image', 'subFrame', 'sub_frame', 'xhr', 'other', 'stylesheet']
    if (pathCheckTypes.includes(resourceType) && this.isAdPath(url)) {
      // Don't block first-party ad paths — only third-party
      if (this.isDifferentDomain(url, pageUrl)) {
        this.stats.blocked++
        return true
      }
    }

    // Block sub_frame (iframe) requests to different domains matching popup ad patterns
    if ((resourceType === 'subFrame' || resourceType === 'sub_frame') && this.isPopupAdDomain(url)) {
      this.stats.blocked++
      return true
    }

    this.stats.allowed++
    return false
  }

  /**
   * Check if a URL belongs to a known popup ad domain.
   */
  private isPopupAdDomain(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      const parts = hostname.split('.')
      for (let i = 0; i < parts.length - 1; i++) {
        const domain = parts.slice(i).join('.')
        if (this.popupDomains.has(domain)) return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Check if two URLs have different registrable domains.
   */
  private isDifferentDomain(url1: string, url2: string): boolean {
    try {
      const host1 = new URL(url1).hostname.toLowerCase()
      const host2 = new URL(url2).hostname.toLowerCase()
      // Compare last two parts (e.g., google.com vs google.com)
      const base1 = host1.split('.').slice(-2).join('.')
      const base2 = host2.split('.').slice(-2).join('.')
      return base1 !== base2
    } catch {
      return true // If we can't parse, assume different (safer)
    }
  }
}
