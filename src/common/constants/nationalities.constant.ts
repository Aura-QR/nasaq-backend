export interface Nationality {
  code: string;
  labelAr: string;
  labelEn: string;
}

// ISO 3166-1 alpha-2 codes for the countries and areas listed by the UN M49 standard.
const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
  'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
  'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
  'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
  'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK',
  'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL',
  'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR',
  'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
  'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
  'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW',
  'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP',
  'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM',
  'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF',
  'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN',
  'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

// Preserve the nationality wording already used by the student form.
const NATIONALITY_LABEL_OVERRIDES: Record<string, Pick<Nationality, 'labelAr' | 'labelEn'>> = {
  SA: { labelAr: 'سعودي', labelEn: 'Saudi' },
  EG: { labelAr: 'مصري', labelEn: 'Egyptian' },
  SY: { labelAr: 'سوري', labelEn: 'Syrian' },
  AE: { labelAr: 'إماراتي', labelEn: 'Emirati' },
  KW: { labelAr: 'كويتي', labelEn: 'Kuwaiti' },
  QA: { labelAr: 'قطري', labelEn: 'Qatari' },
  BH: { labelAr: 'بحريني', labelEn: 'Bahraini' },
  OM: { labelAr: 'عماني', labelEn: 'Omani' },
  JO: { labelAr: 'أردني', labelEn: 'Jordanian' },
  LB: { labelAr: 'لبناني', labelEn: 'Lebanese' },
  IQ: { labelAr: 'عراقي', labelEn: 'Iraqi' },
  YE: { labelAr: 'يمني', labelEn: 'Yemeni' },
  SD: { labelAr: 'سوداني', labelEn: 'Sudanese' },
  LY: { labelAr: 'ليبي', labelEn: 'Libyan' },
  TN: { labelAr: 'تونسي', labelEn: 'Tunisian' },
  DZ: { labelAr: 'جزائري', labelEn: 'Algerian' },
  MA: { labelAr: 'مغربي', labelEn: 'Moroccan' },
  PS: { labelAr: 'فلسطيني', labelEn: 'Palestinian' },
  US: { labelAr: 'أمريكي', labelEn: 'American' },
  GB: { labelAr: 'بريطاني', labelEn: 'British' },
  CA: { labelAr: 'كندي', labelEn: 'Canadian' },
  AU: { labelAr: 'أسترالي', labelEn: 'Australian' },
  IN: { labelAr: 'هندي', labelEn: 'Indian' },
  PK: { labelAr: 'باكستاني', labelEn: 'Pakistani' },
  BD: { labelAr: 'بنغلاديشي', labelEn: 'Bangladeshi' },
  PH: { labelAr: 'فلبيني', labelEn: 'Filipino' },
  ID: { labelAr: 'إندونيسي', labelEn: 'Indonesian' },
  MY: { labelAr: 'ماليزي', labelEn: 'Malaysian' },
  TR: { labelAr: 'تركي', labelEn: 'Turkish' },
  TM: { labelAr: 'تركماني', labelEn: 'Turkmen' },
  FR: { labelAr: 'فرنسي', labelEn: 'French' },
  DE: { labelAr: 'ألماني', labelEn: 'German' },
  IT: { labelAr: 'إيطالي', labelEn: 'Italian' },
  ES: { labelAr: 'إسباني', labelEn: 'Spanish' },
};

const arabicRegionNames = new Intl.DisplayNames(['ar'], { type: 'region' });
const englishRegionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export const NATIONALITIES: Nationality[] = COUNTRY_CODES.map((code) => {
  const override = NATIONALITY_LABEL_OVERRIDES[code];
  return {
    code,
    labelAr: override?.labelAr ?? arabicRegionNames.of(code),
    labelEn: override?.labelEn ?? englishRegionNames.of(code),
  };
});

export const NATIONALITY_CODES = NATIONALITIES.map(n => n.code);
