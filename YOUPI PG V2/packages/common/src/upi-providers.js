/**
 * Central registry of 30 official UPI application providers.
 * Real official Google Play Store listing CDN icons and official brand assets.
 */
export const UPI_PROVIDERS = [
  {
    id: 'google-pay',
    name: 'Google Pay',
    shortName: 'GPay',
    packageName: 'com.google.android.apps.nbu.paisa.user',
    iconUrl: 'https://play-lh.googleusercontent.com/Wbik2RoUSGgWEg8ybAhFaMJO2fE7x9gqCXfwbmW0YPjh6TKcjKzecth8GaYkbUBYtLZXhyfVMpqkIuJgTM8p=s180-rw',
    brandColor: '#1a73e8',
    searchKeywords: ['google', 'gpay', 'pay', 'googlepay'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.4 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5c11 0 20-8 20-20 0-1.5-.2-2.9-.4-4.4z" fill="#4285F4"/><path d="M6.3 14.7l6.6 4.8C14.7 15.6 19 12.5 24 12.5c3.1 0 5.8 1.1 8 3l6-6C34.4 5.5 29.5 3.5 24 3.5c-7.7 0-14.4 4.3-17.7 11.2z" fill="#EA4335"/><path d="M24 44.5c5.3 0 10.2-1.9 13.9-5.1l-6.4-5.2c-2.1 1.4-4.6 2.3-7.5 2.3-5.3 0-9.7-3.3-11.3-8l-6.6 5.1C9.3 40.4 16.1 44.5 24 44.5z" fill="#34A853"/><path d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4 5.7l6.4 5.2c4.3-4 6.8-9.8 6.8-14.9 0-1.5-.2-2.9-.5-3.9z" fill="#FBBC05"/></svg>'
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    shortName: 'PhonePe',
    packageName: 'com.phonepe.app',
    iconUrl: 'https://play-lh.googleusercontent.com/ARGoCZk-5QCKPpyTsGhn1WahhPbVMa95T1U7clwnI8gjtW-YNY96rAANqFkuENbU35IbYF2Gjg2UjZXA495x0A=s180-rw',
    brandColor: '#5f259f',
    searchKeywords: ['phonepe', 'phone', 'pe'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#5f259f"/><path d="M28.5 21.5h-5.2v-2.8c0-.7.6-1.3 1.3-1.3h3.9c.6 0 1-.4 1-1s-.4-1-1-1h-3.9c-1.8 0-3.3 1.5-3.3 3.3v2.8H18c-.6 0-1 .4-1 1s.4 1 1 1h3.3v13c0 .6.4 1 1 1s1-.4 1-1V23.5h5.2c3.2 0 5.8-2.6 5.8-5.8s-2.6-5.8-5.8-5.8h-1.5c-.6 0-1 .4-1 1s.4 1 1 1h1.5c2.1 0 3.8 1.7 3.8 3.8s-1.7 3.8-3.8 3.8z" fill="#fff"/></svg>'
  },
  {
    id: 'paytm',
    name: 'Paytm',
    shortName: 'Paytm',
    packageName: 'net.one97.paytm',
    iconUrl: 'https://play-lh.googleusercontent.com/WDGsMRuVENnZPEpV4DEaXw12qtMY3em85xpmZqcXzeh0iT_eXFtAU9VUj-Z7xNQQd5DMqrkKSs9D0qbI1rlt=s180-rw',
    brandColor: '#00b9f5',
    searchKeywords: ['paytm', 'pay', 'wallet'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#002e6e"/><path d="M12 28V16h4.5c2.8 0 4.8 1.8 4.8 4.5s-2 4.5-4.8 4.5H15V28h-3zm3-6h1.5c1.1 0 1.8-.7 1.8-1.5s-.7-1.5-1.8-1.5H15V22z" fill="#00b9f5"/><path d="M22 28V16h3v12h-3z" fill="#00b9f5"/><path d="M26 28l4-8-4-4h3.5l2.2 4.8 2.2-4.8h3.5l-4 4 4 8h-3.5L32 23.5 30 28H26z" fill="#00b9f5"/></svg>'
  },
  {
    id: 'bhim',
    name: 'BHIM',
    shortName: 'BHIM',
    packageName: 'in.org.npci.upiapp',
    iconUrl: 'https://play-lh.googleusercontent.com/rPJLwugORRZudZYpG6HrP2ejHgdinQzqkKgdPvsoCM5jc_7d507xaYCVUWELWOTu2OEEdwtZNJ7ySq5Mpj2S7DQ=s180-rw',
    brandColor: '#00796b',
    searchKeywords: ['bhim', 'npci', 'upi'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#00796b"/><path d="M14 12h8c3.3 0 6 2.7 6 6 0 1.9-.9 3.6-2.3 4.7 2 .9 3.3 2.9 3.3 5.3 0 3.3-2.7 6-6 6h-9V12zm4 4v5h4c1.1 0 2-.9 2-2s-.9-2-2-2h-4zm0 9v5h5c1.1 0 2-.9 2-2s-.9-2-2-2h-5z" fill="#fff"/><path d="M30 12l6 12-6 12h4l6-12-6-12h-4z" fill="#f57c00"/></svg>'
  },
  {
    id: 'amazon-pay',
    name: 'Amazon Pay',
    shortName: 'Amazon Pay',
    packageName: 'in.amazon.mShop.android.shopping',
    iconUrl: 'https://play-lh.googleusercontent.com/E2Nyw1kSrYFvi5DFOznWOR2iXY9mwxwfYHXV37aLHmuKtEW3gs7StIvVptoV2x8_ykiHQQmliwpfDsFm0Quuwbk=s180-rw',
    brandColor: '#232f3e',
    searchKeywords: ['amazon', 'amazonpay', 'pay'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#232f3e"/><path d="M12 28c8 5 18 5 24 0" stroke="#ff9900" stroke-width="3" stroke-linecap="round"/><path d="M34 26l3 2-2 3" stroke="#ff9900" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 16c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5zm0 2.5c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5-2.5-1.1-2.5-2.5 1.1-2.5 2.5-2.5z" fill="#fff"/></svg>'
  },
  {
    id: 'cred',
    name: 'CRED',
    shortName: 'CRED',
    packageName: 'com.dreamplug.androidapp',
    iconUrl: 'https://play-lh.googleusercontent.com/PJvM1900ufKia-hc7l7eaU0quGrOm_sx1x_szS_-lA7kRm9sb7gr1cgI8uQMH7tq3n-vnx0SkIUZa19fwz2G=s180-rw',
    brandColor: '#121212',
    searchKeywords: ['cred', 'upi', 'rewards'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#121212"/><path d="M14 14h20v20H14V14z" stroke="#fff" stroke-width="3" fill="none"/><path d="M18 18h12v12H18V18z" fill="#fff"/></svg>'
  },
  {
    id: 'imobile-pay',
    name: 'iMobile Pay',
    shortName: 'iMobile',
    packageName: 'com.csam.icici.bank.imobile',
    iconUrl: 'https://play-lh.googleusercontent.com/dmco3u7SKC9ldQVrGknBkeNeaMUVYAcWzo1hNtb4AbxIcR_EP-0drTWvDhi3C_wC7ul5oynYpKJBVZhKr4GCAA=s180-rw',
    brandColor: '#b02a30',
    searchKeywords: ['icici', 'imobile', 'bank'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#b02a30"/><path d="M16 14h6v20h-6V14zm10 0h6v20h-6V14z" fill="#fff"/><circle cx="19" cy="10" r="2" fill="#f37021"/></svg>'
  },
  {
    id: 'sbi-pay',
    name: 'SBI Pay',
    shortName: 'SBI Pay',
    packageName: 'com.sbi.upi',
    iconUrl: 'https://play-lh.googleusercontent.com/xfLptGZNr6_500DZ1neKUnhZ3uJxvE25BpcLwFgxfhv06igupXTWg2XnLgnCgkKMxe_My566wH6jwNkvhLtr=s180-rw',
    brandColor: '#280071',
    searchKeywords: ['sbi', 'sbipay', 'yono', 'state bank'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#280071"/><circle cx="24" cy="24" r="14" fill="#00a3e0"/><circle cx="24" cy="24" r="5" fill="#280071"/><path d="M22 24h4v14h-4V24z" fill="#280071"/></svg>'
  },
  {
    id: 'kotak-bank',
    name: 'Kotak Mobile Banking',
    shortName: 'Kotak',
    packageName: 'com.msf.kbank.mobile',
    iconUrl: 'https://play-lh.googleusercontent.com/zZUi3xWDKjYFW89Zyy-xNSTthNHUrG3AsgTDysW-oWzgTBVlLgxbL7pIWjz9wj_aZr26s4xQf5-LruhgxtiOdy8=s180-rw',
    brandColor: '#ed1c24',
    searchKeywords: ['kotak', '811', 'kbank'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#ed1c24"/><circle cx="24" cy="24" r="12" stroke="#fff" stroke-width="4" fill="none"/><path d="M24 16v16M16 24h16" stroke="#fff" stroke-width="4"/></svg>'
  },
  {
    id: 'bhim-axis-pay',
    name: 'BHIM Axis Pay',
    shortName: 'Axis Pay',
    packageName: 'com.upi.axispay',
    iconUrl: 'https://play-lh.googleusercontent.com/OQSiBrgEsPz11-K5CFO2p4QzDOhKGkUgzso5NCMKlvlgux6Pvt_sFd3OBoIdhMnEXb6IErxGS6DQtz_nS35nVp4=s180-rw',
    brandColor: '#97144d',
    searchKeywords: ['axis', 'axispay', 'bhim axis'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#97144d"/><path d="M24 10l12 24H12L24 10z" fill="#fff"/><path d="M24 18l6 12H18l6-12z" fill="#97144d"/></svg>'
  },
  {
    id: 'axis-mobile',
    name: 'Axis Mobile',
    shortName: 'Axis Mobile',
    packageName: 'com.axis.mobile',
    iconUrl: 'https://play-lh.googleusercontent.com/OQSiBrgEsPz11-K5CFO2p4QzDOhKGkUgzso5NCMKlvlgux6Pvt_sFd3OBoIdhMnEXb6IErxGS6DQtz_nS35nVp4=s180-rw',
    brandColor: '#97144d',
    searchKeywords: ['axis', 'axis mobile', 'bank'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#97144d"/><path d="M14 34L24 14l10 20H14z" fill="#fff"/></svg>'
  },
  {
    id: 'hdfc-bank',
    name: 'HDFC Bank',
    shortName: 'HDFC Bank',
    packageName: 'com.snapwork.hdfc',
    iconUrl: 'https://play-lh.googleusercontent.com/xj4AYs3IX_hcELMoicEJj2B4MpbpGQP2TW8klh6b9Ipv6ljNsrlROwpQS_seqQ74oT9HxtKrOiTsKHLPseYx=s180-rw',
    brandColor: '#004c8f',
    searchKeywords: ['hdfc', 'bank', 'mobilebanking'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#004c8f"/><rect x="14" y="14" width="20" height="20" fill="#ed1c24"/><rect x="18" y="18" width="12" height="12" fill="#004c8f"/><rect x="22" y="10" width="4" height="28" fill="#004c8f"/><rect x="10" y="22" width="28" height="4" fill="#004c8f"/></svg>'
  },
  {
    id: 'icici-pockets',
    name: 'ICICI Pockets',
    shortName: 'Pockets',
    packageName: 'com.icicibank.pockets',
    iconUrl: 'https://play-lh.googleusercontent.com/zDsjAWfZtiVzIWoFT3MhcY_ivu5InlxdrmfyCPQhcKjaFtvIO0CGwJ2rzURrmV71F9Kt4-3n-p_GRHerXibVYA=s180-rw',
    brandColor: '#f37021',
    searchKeywords: ['pockets', 'icici', 'wallet'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#f37021"/><circle cx="24" cy="24" r="12" fill="#fff"/><path d="M20 20h8v8h-8z" fill="#b02a30"/></svg>'
  },
  {
    id: 'idfc-first-bank',
    name: 'IDFC FIRST Bank',
    shortName: 'IDFC FIRST',
    packageName: 'com.idfcfirstbank.optimus',
    iconUrl: 'https://play-lh.googleusercontent.com/WzDtotDEhTRKaEm06LbJuTZ5sm54Bx-qSWYRULxlUboNbFOJGRvrlJ8kFr_Vk7AePA3ATkTk3UmEO3ITQc2_yQ=s180-rw',
    brandColor: '#9d1d27',
    searchKeywords: ['idfc', 'first bank', 'idfcfirst'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#9d1d27"/><path d="M16 16h16v16H16z" fill="#f37021"/><path d="M20 20h8v8h-8z" fill="#fff"/></svg>'
  },
  {
    id: 'induspay',
    name: 'IndusPay',
    shortName: 'IndusPay',
    packageName: 'com.mgs.induspsp',
    iconUrl: 'https://play-lh.googleusercontent.com/5CWr-hYR57D7-5s51SsPlm69to3NE5poC5ChdxWjSq31cevVW7Oo-U9yhX7mUIcFdF5FQNFFdD0N4MYubUZh3A=s180-rw',
    brandColor: '#84191b',
    searchKeywords: ['indusind', 'induspay', 'indus'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#84191b"/><path d="M14 24c0-5.5 4.5-10 10-10s10 4.5 10 10-4.5 10-10 10-10-4.5-10-10z" fill="#fff"/><path d="M24 16v16" stroke="#84191b" stroke-width="3"/></svg>'
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    shortName: 'Jupiter',
    packageName: 'money.jupiter',
    iconUrl: 'https://play-lh.googleusercontent.com/hoFj8VTUn0aM2SBW9nmje6E0wX7B-hAj4uvbl2CqJnDMrXoKkrkemgxPLOOycFfmOL0cXziJpa-Ae-T5pS1QE-o=s180-rw',
    brandColor: '#ff7754',
    searchKeywords: ['jupiter', 'money', 'banking'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#ff7754"/><circle cx="24" cy="24" r="10" fill="#fff"/><circle cx="28" cy="20" r="3" fill="#ff7754"/></svg>'
  },
  {
    id: 'mobikwik',
    name: 'MobiKwik',
    shortName: 'MobiKwik',
    packageName: 'com.mobikwik_new',
    iconUrl: 'https://play-lh.googleusercontent.com/Uvs56Ws0HOjsm7iOkl7nWaPHutFkZBwr6JoMu4bGCSGyQUyGD8FwzPF-LdrkTZC9M2vVDIF9ocznlv2y334Z=s180-rw',
    brandColor: '#0075d3',
    searchKeywords: ['mobikwik', 'wallet', 'zip'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#0075d3"/><path d="M14 16l10 8 10-8v16H14V16z" fill="#fff"/></svg>'
  },
  {
    id: 'airtel-thanks',
    name: 'Airtel Thanks',
    shortName: 'Airtel',
    packageName: 'com.myairtelapp',
    iconUrl: 'https://play-lh.googleusercontent.com/v00UJ-fq2PRJgxukJtiZY5JVGcP-uEi44zRWWIgTaB7kw6lZ8KOxpqTsIQe-MLcS_ojUT3XXY-XfoiCUL1J9lg=s180-rw',
    brandColor: '#e40000',
    searchKeywords: ['airtel', 'thanks', 'payments bank'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#e40000"/><path d="M16 28c4-12 12-12 16 0" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>'
  },
  {
    id: 'freecharge',
    name: 'Freecharge',
    shortName: 'Freecharge',
    packageName: 'com.freecharge.android',
    iconUrl: 'https://play-lh.googleusercontent.com/e5Y4ftiOjuk-WWQiDfof8HEk3UvqmqYUuKpJqszr6vEgyIg0H4Z-r47GV6fTSC339hgzPuz9Waa0Ir5Lxuqa_A=s180-rw',
    brandColor: '#53b449',
    searchKeywords: ['freecharge', 'axis', 'wallet'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#53b449"/><path d="M26 12L16 26h8l-2 10 12-14h-8l2-10z" fill="#fff"/></svg>'
  },
  {
    id: 'samsung-pay',
    name: 'Samsung Pay',
    shortName: 'Samsung Pay',
    packageName: 'com.samsung.android.spay',
    iconUrl: 'https://play-lh.googleusercontent.com/Oy8bbVOACpQsG-1SVj1KgA_6hL1mGS8iI1zy9Z0NgK2Kz_dLyDNfpDFDY0BmKN52x9Y4vvHfcQYF8wVeW5K5zQ=s180-rw',
    brandColor: '#1259c3',
    searchKeywords: ['samsung', 'wallet', 'spay'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#1259c3"/><rect x="14" y="16" width="20" height="16" rx="3" stroke="#fff" stroke-width="3" fill="none"/><path d="M14 22h20" stroke="#fff" stroke-width="2"/></svg>'
  },
  {
    id: 'truecaller',
    name: 'Truecaller',
    shortName: 'Truecaller',
    packageName: 'com.truecaller',
    iconUrl: 'https://play-lh.googleusercontent.com/kVMxXC3fV4cyG56MZunYS2-HYaHh3eM3YTWoDbYaN5-G9xIU2k235hHVQmRrm79tzBSzt0cZ6GsBbzGzGbbMwg=s180-rw',
    brandColor: '#0087ff',
    searchKeywords: ['truecaller', 'caller', 'upi'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#0087ff"/><path d="M18 16c2-2 4-2 6 0l2 3c1 1 1 2 0 3l-2 2c2 3 4 5 7 7l2-2c1-1 2-1 3 0l3 2c2 2 2 4 0 6-3 3-8 2-14-4s-7-11-4-14z" fill="#fff"/></svg>'
  },
  {
    id: 'tata-neu',
    name: 'Tata Neu',
    shortName: 'Tata Neu',
    packageName: 'com.tatadigital.tcp',
    iconUrl: 'https://play-lh.googleusercontent.com/kTa8k1W70pv5O5IUt5PyjUa7GNp3B30mlBqDAwmhEDYbM3N0n1zDGF27EbNdXq2gt22VYX0SmtRp-SttEU_s3Q=s180-rw',
    brandColor: '#68297b',
    searchKeywords: ['tata', 'neu', 'tatapay'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#68297b"/><circle cx="24" cy="24" r="12" stroke="#fff" stroke-width="3" fill="none"/><path d="M20 20l8 8" stroke="#fff" stroke-width="3"/></svg>'
  },
  {
    id: 'slice',
    name: 'Slice',
    shortName: 'Slice',
    packageName: 'indwin.c3.shareapp',
    iconUrl: 'https://play-lh.googleusercontent.com/WfVXB0bKHlMXCdaed1pcALPt8spjVgMs13EEvlus6ZJHH4xeiUaqHiHYopc5jZXqy8DLdjU0TU3S7loqisQjVw=s180-rw',
    brandColor: '#753bdf',
    searchKeywords: ['slice', 'upi', 'card'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#753bdf"/><path d="M14 24h20M24 14v20" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>'
  },
  {
    id: 'kiwi',
    name: 'Kiwi',
    shortName: 'Kiwi',
    packageName: 'in.gokiwi.kiwitpap',
    iconUrl: 'https://play-lh.googleusercontent.com/Kfy6YJA0m5Oqo63MWzOHCi5E2rYdHmN2AK6KqlKPqv7OKrXYsM2rCWNiSecuQZxsXKBZK3BwKCKFDj2wvkxj5Q=s180-rw',
    brandColor: '#96d800',
    searchKeywords: ['kiwi', 'rupay', 'rewards'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#96d800"/><circle cx="24" cy="24" r="12" fill="#2d3748"/><circle cx="24" cy="24" r="6" fill="#fff"/></svg>'
  },
  {
    id: 'fi-money',
    name: 'Fi Money',
    shortName: 'Fi Money',
    packageName: 'com.epifi.paisa',
    iconUrl: 'https://fi.money/assets/svgs/logo.svg',
    brandColor: '#00d09c',
    searchKeywords: ['fi', 'epifi', 'federal', 'money'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M31.331 12.825c0-3.206 2.699-5.797 6.024-5.797s6.027 2.596 6.027 5.797-2.699 5.797-6.027 5.797-6.024-2.591-6.024-5.797zM48 35.662h-1.347c-2.763 0-4.156-1.96-4.156-5.047v-5.797h-10.21v8.216c0 8.927 5.918 12.674 11.646 12.674H48V35.662zM14.226 38.42c0-2.986 1.652-4.344 5.007-4.344h8.325v-9.284H14.226v-3.833c0-3.032 2.617-4.68 5.742-4.68h7.577V7H17.363C9.362 7 4 11.234 4 20.11v25.575h10.226V38.42z" fill="#00b899"/></svg>'
  },
  {
    id: 'groww',
    name: 'Groww',
    shortName: 'Groww',
    packageName: 'com.nextbillion.groww',
    iconUrl: 'https://play-lh.googleusercontent.com/dG1q2wx6Nk3aN6FIna144DYXI51P1cnbmBSRSvxKMZcZEDXcBv1-clSpc_PgjsE-UkGUCmX1kvRF-D443l3e=s180-rw',
    brandColor: '#00d09c',
    searchKeywords: ['groww', 'stocks', 'pay'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#121212"/><circle cx="24" cy="24" r="12" fill="#00d09c"/><path d="M20 28l4-8 4 8" stroke="#121212" stroke-width="2" fill="none"/></svg>'
  },
  {
    id: 'bandhan-upi',
    name: 'Bandhan UPI',
    shortName: 'Bandhan',
    packageName: 'com.fisglobal.bandhanupi.app',
    iconUrl: 'https://play-lh.googleusercontent.com/A-jnlycom7vmHnVoXaEJHKYH4DtqZR_XAUuZeVSY7aOzKGXDYZtyoMNxIwkvRh0csi78rryuel-hQELqoPUq=s180-rw',
    brandColor: '#003366',
    searchKeywords: ['bandhan', 'bandhanbank', 'mbandhan'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#003366"/><path d="M16 16h16v16H16z" stroke="#ed1c24" stroke-width="3" fill="none"/></svg>'
  },
  {
    id: 'bank-of-baroda',
    name: 'Bank of Baroda',
    shortName: 'BOB',
    packageName: 'com.bankofbaroda.upi',
    iconUrl: 'https://play-lh.googleusercontent.com/d-8feMJrkwfK7a52y54FqOcDmsP0RfkunIAhkCXUKEKIAjdPfWhgleGbw7sz9Q5vMbUjQrldIgWle77Y1co9sw=s180-rw',
    brandColor: '#f26522',
    searchKeywords: ['bob', 'baroda', 'bobworld'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#f26522"/><circle cx="24" cy="24" r="10" stroke="#fff" stroke-width="4" fill="none"/></svg>'
  },
  {
    id: 'canara-bank',
    name: 'Canara Bank',
    shortName: 'Canara',
    packageName: 'com.canarabank.mobility',
    iconUrl: 'https://play-lh.googleusercontent.com/B-5J_cjTSG0wHM6S1XvOSSI12n6OCeKA6QsICTeAEjhb7Xusf7b5VCzGTDBOdHwQJkRpdUCOEZdUytAcJxy0LQ=s180-rw',
    brandColor: '#0091da',
    searchKeywords: ['canara', 'ai1', 'canarabank'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#0091da"/><path d="M16 28l8-14 8 14H16z" fill="#fdb913"/></svg>'
  },
  {
    id: 'union-bank',
    name: 'Union Bank',
    shortName: 'Union Bank',
    packageName: 'com.infrasoft.uboi',
    iconUrl: 'https://play-lh.googleusercontent.com/pH69DoogXyzHVcGVKanlBfIBVCvX8WMQ1MZpqKM1_OHva4YTPchbq9n-ANXlEigGVst8657dp7iMmSWwVlB_=s180-rw',
    brandColor: '#004c8f',
    searchKeywords: ['union', 'uboi', 'vyom'],
    enabled: true,
    svgLogo: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="12" fill="#004c8f"/><path d="M16 16v10c0 4.4 3.6 8 8 8s8-3.6 8-8V16h-4v10c0 2.2-1.8 4-4 4s-4-1.8-4-4V16h-4z" fill="#fff"/></svg>'
  }
];

export function getUpiProviders() {
  return [...UPI_PROVIDERS];
}

export function findUpiProviderByPackage(packageName) {
  if (!packageName) return undefined;
  const clean = packageName.trim().toLowerCase();
  return UPI_PROVIDERS.find(p => p.packageName.toLowerCase() === clean);
}

export function findUpiProviderById(id) {
  if (!id) return undefined;
  const clean = id.trim().toLowerCase();
  return UPI_PROVIDERS.find(p => p.id.toLowerCase() === clean);
}
