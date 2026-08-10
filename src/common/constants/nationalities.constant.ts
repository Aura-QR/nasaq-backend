export interface Nationality {
  code: string;
  labelAr: string;
  labelEn: string;
}

export const NATIONALITIES: Nationality[] = [
  { code: 'SA', labelAr: 'سعودي', labelEn: 'Saudi' },
  { code: 'EG', labelAr: 'مصري', labelEn: 'Egyptian' },
  { code: 'SY', labelAr: 'سوري', labelEn: 'Syrian' },
  { code: 'AE', labelAr: 'إماراتي', labelEn: 'Emirati' },
  { code: 'KW', labelAr: 'كويتي', labelEn: 'Kuwaiti' },
  { code: 'QA', labelAr: 'قطري', labelEn: 'Qatari' },
  { code: 'BH', labelAr: 'بحريني', labelEn: 'Bahraini' },
  { code: 'OM', labelAr: 'عماني', labelEn: 'Omani' },
  { code: 'JO', labelAr: 'أردني', labelEn: 'Jordanian' },
  { code: 'LB', labelAr: 'لبناني', labelEn: 'Lebanese' },
  { code: 'IQ', labelAr: 'عراقي', labelEn: 'Iraqi' },
  { code: 'YE', labelAr: 'يمني', labelEn: 'Yemeni' },
  { code: 'SD', labelAr: 'سوداني', labelEn: 'Sudanese' },
  { code: 'LY', labelAr: 'ليبي', labelEn: 'Libyan' },
  { code: 'TN', labelAr: 'تونسي', labelEn: 'Tunisian' },
  { code: 'DZ', labelAr: 'جزائري', labelEn: 'Algerian' },
  { code: 'MA', labelAr: 'مغربي', labelEn: 'Moroccan' },
  { code: 'PS', labelAr: 'فلسطيني', labelEn: 'Palestinian' },
  { code: 'US', labelAr: 'أمريكي', labelEn: 'American' },
  { code: 'GB', labelAr: 'بريطاني', labelEn: 'British' },
  { code: 'CA', labelAr: 'كندي', labelEn: 'Canadian' },
  { code: 'AU', labelAr: 'أسترالي', labelEn: 'Australian' },
  { code: 'IN', labelAr: 'هندي', labelEn: 'Indian' },
  { code: 'PK', labelAr: 'باكستاني', labelEn: 'Pakistani' },
  { code: 'BD', labelAr: 'بنغلاديشي', labelEn: 'Bangladeshi' },
  { code: 'PH', labelAr: 'فلبيني', labelEn: 'Filipino' },
  { code: 'ID', labelAr: 'إندونيسي', labelEn: 'Indonesian' },
  { code: 'MY', labelAr: 'ماليزي', labelEn: 'Malaysian' },
  { code: 'TR', labelAr: 'تركي', labelEn: 'Turkish' },
  { code: 'FR', labelAr: 'فرنسي', labelEn: 'French' },
  { code: 'DE', labelAr: 'ألماني', labelEn: 'German' },
  { code: 'IT', labelAr: 'إيطالي', labelEn: 'Italian' },
  { code: 'ES', labelAr: 'إسباني', labelEn: 'Spanish' },
];

export const NATIONALITY_CODES = NATIONALITIES.map(n => n.code);
