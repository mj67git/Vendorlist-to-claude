import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { GradeBadge } from '../../components/GradeBadge';
import { getScoreColorClass } from '../../components/ScoreBar';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { BusinessPartner, Category, Scores, User, Vendor } from '../../types';
import { isVendorRejected } from '../../utils/vendorState';
import { calculateOverallScore, checkLicenseExpiry, getDisplayCountry } from '../../utils/vendorUtils';
import { resolveVendorPartner } from '../../utils/vendorPartner';
import { MaterialsComparisonSection, type SourceSelectionRecord } from './MaterialsComparisonSection';

// extracted from App.tsx

export const MaterialGroup: React.FC<{ 
  group: { fa: string, en: string, cas: string, vendors: Vendor[] }, 
  onSelectVendor: any, 
  currentUser: User, 
  categoryId?: Category,
  expandedMaterial: string | null,
  onToggleMaterial: (mat: string | null) => void,
  partners?: BusinessPartner[],
  selection?: SourceSelectionRecord | null,
  onSelectSource?: (vendorId: string) => void
}> = ({ group, onSelectVendor, currentUser, categoryId, expandedMaterial, onToggleMaterial, partners = [], selection, onSelectSource }) => {
  const [localOpen, setLocalOpen] = useState(group.en === expandedMaterial);
  const [highlight, setHighlight] = useState(false);
  const manualRef = useRef(false);
  const elementId = `group-${group.en.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;


  useEffect(() => {
    if (group.en === expandedMaterial) {
      // This material is the active one: open it, scroll it into view, and —
      // when the open was triggered externally (e.g. returning from a source
      // detail, not a manual click) — briefly highlight it so the user can
      // confirm they landed back on the right material.
      setLocalOpen(true);
      const external = !manualRef.current;
      manualRef.current = false;
      let highlightTimer: ReturnType<typeof setTimeout> | undefined;
      if (external) {
        setHighlight(true);
        highlightTimer = setTimeout(() => setHighlight(false), 1600);
      }
      const scrollTimer = setTimeout(() => {
        const el = document.getElementById(elementId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 250);
      return () => { clearTimeout(scrollTimer); if (highlightTimer) clearTimeout(highlightTimer); };
    } else if (expandedMaterial !== null) {
      // A different material became the active one — collapse this one so the
      // list behaves as a real accordion (only one open at a time).
      manualRef.current = false;
      setLocalOpen(false);
    }
  }, [expandedMaterial, group.en, elementId]);

  const isOpen = localOpen;

  const toggleGroup = () => {
    const nextOpen = !isOpen;
    manualRef.current = true;
    setLocalOpen(nextOpen);
    if (nextOpen) {
      onToggleMaterial(group.en);
    } else if (expandedMaterial === group.en) {
      onToggleMaterial(null);
    }
  };

  return (
    <Card id={elementId} className={`overflow-hidden shadow-xs hover:shadow-sm transition-all duration-500 scroll-mt-52 sm:scroll-mt-48 ${highlight ? 'border-primary ring-2 ring-primary/40 shadow-md' : 'border-border/80'}`}>
      <div 
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={`${elementId}-content`}
        onClick={toggleGroup}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGroup();
          }
        }}
        className="bg-muted/30 hover:bg-muted/60 cursor-pointer px-5 py-4 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-border/70 transition-colors"
      >
        <div className="flex items-center gap-3.5">
          <ChevronLeft className={`w-5 h-5 text-primary transition-transform duration-300 ${isOpen ? '-rotate-90' : 'rotate-0'}`} />
          <div className="text-right">
            <h3 className="font-bold text-base text-foreground mb-1">
              {group.fa} <span className="text-muted-foreground text-sm font-normal ml-2">/ {group.en}</span>
            </h3>
            <div className="flex items-center gap-2 text-xs mt-1">
              <Badge variant="outline" className="font-mono text-[11px] px-2 py-0">
                CAS: {group.cas}
              </Badge>
            </div>
          </div>
        </div>
        <div className="mt-3 md:mt-0 text-xs text-muted-foreground mr-8 md:mr-0 font-medium">
          <span className="text-foreground font-bold font-mono text-sm ml-1">{group.vendors.length}</span> سورس ثبتی
        </div>
      </div>
      
      <div
        id={`${elementId}-content`}
        aria-hidden={!isOpen}
        className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="divide-y divide-border/60 bg-card">
            {group.vendors.map(vendor => {
              const { name: partnerName, roleLabel: partnerLabel } = resolveVendorPartner(vendor, partners);
              return (
                <div 
                  key={vendor.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`مشاهده جزئیات ${vendor.name}`}
                  onClick={() => onSelectVendor(vendor)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectVendor(vendor);
                    }
                  }}
                  className="px-5 py-4 flex items-center justify-between hover:bg-muted/40 cursor-pointer transition-colors group"
                >
                  {/* Right side: Name & Status */}
                  <div className="flex items-center gap-3.5">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      isVendorRejected(vendor) ? 'bg-red-500' :
                      vendor.isSample ? (
                        vendor.status === 'approved' ? 'bg-emerald-500' :
                        vendor.status === 'conditional' ? 'bg-amber-500' : 'bg-cyan-500'
                      ) : (
                        vendor.grade === 'A' ? 'bg-emerald-500' :
                        vendor.grade === 'B' ? 'bg-[#0071E3]' :
                        vendor.grade === 'C' ? 'bg-amber-500' :
                        vendor.status === 'conditional' ? 'bg-amber-500' : 'bg-cyan-500'
                      )
                    }`} />
                    <div className="text-right space-y-1">
                      {/* 1. Name of Material */}
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-bold">نام ماده اولیه</Badge>
                        <span className="font-bold text-foreground">{vendor.material}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">({vendor.materialEn})</span>
                      </div>
                      
                      {/* 2. Supplier / Manufacturer (single partner) */}
                      <div className="font-bold text-base text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{partnerLabel}</span>
                        <span>{partnerName}</span>
                      </div>

                      {/* 3. Metadata line (English name, country, licence expiry) */}
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                        {vendor.nameEn && vendor.nameEn.trim() && vendor.nameEn.toLowerCase() !== 'n/a' && vendor.nameEn.toLowerCase() !== 'unknown' && (
                          <span className="font-mono text-[10px] text-muted-foreground">{vendor.nameEn}</span>
                        )}
                        {(() => {
                          const displayCountry = getDisplayCountry(vendor);
                          if (displayCountry && displayCountry.trim() && displayCountry.toLowerCase() !== 'unknown' && displayCountry.toLowerCase() !== 'n/a' && displayCountry !== 'نامشخص') {
                            return (
                              <>
                                <span className="text-border">|</span>
                                <span className="font-sans font-medium text-muted-foreground">{displayCountry}</span>
                              </>
                            );
                          }
                          return null;
                        })()}
                        {vendor.ircExpiryDate && (() => {
                          const check = checkLicenseExpiry(vendor.ircExpiryDate);
                          if (check.status === 'expired') {
                            return (
                              <>
                                <span className="text-border">|</span>
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-bold">
                                  مجوز منقضی
                                </Badge>
                              </>
                            );
                          }
                          if (check.status === 'expiring_soon') {
                            return (
                              <>
                                <span className="text-border">|</span>
                                <Badge variant="warning" className="text-[10px] px-1.5 py-0 font-bold">
                                  انقضای مجوز: {check.daysLeft} روز
                                </Badge>
                              </>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Left side: Score & Grade */}
                  <div className="flex items-center gap-6">
                    {/* Column 1: Score */}
                    <div className="hidden sm:flex w-28 sm:w-32 shrink-0 flex-col items-center justify-center text-center">
                      {currentUser?.role === 'admin' ? (
                        vendor.scores && calculateOverallScore(vendor.scores) !== null ? (
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground mb-0.5">امتیاز کل</div>
                            <div className={`font-bold font-mono text-sm ${getScoreColorClass(calculateOverallScore(vendor.scores))}`}>
                              {calculateOverallScore(vendor.scores)}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground">- بدون امتیاز -</div>
                        )
                      ) : (
                        vendor.scores && vendor.scores[currentUser?.role as keyof Scores] > 0 ? (
                          <div className="text-center">
                            <div className="text-[10px] text-muted-foreground mb-0.5">امتیاز بخش شما</div>
                            <div className={`font-bold font-mono text-sm ${getScoreColorClass(vendor.scores[currentUser?.role as keyof Scores])}`}>
                              {vendor.scores[currentUser?.role as keyof Scores]}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">عدم ثبت امتیاز</div>
                        )
                      )}
                    </div>

                    {/* Column 2: Risk Level */}
                    {categoryId !== 'blacklist' && (
                      <div className="hidden sm:flex w-24 sm:w-28 shrink-0 flex-col items-center justify-center text-center">
                        <div className="text-[10px] text-muted-foreground mb-0.5">سطح ریسک</div>
                        {vendor.riskAssessment ? (
                          <Badge 
                            variant={
                              vendor.riskAssessment.riskLevel === 'Low' ? 'gradeA' :
                              vendor.riskAssessment.riskLevel === 'Medium' ? 'gradeC' : 'gradeReject'
                            }
                            className="text-[10px] font-bold px-2 py-0"
                          >
                            {vendor.riskAssessment.riskLevel === 'Low' ? 'Low Risk' :
                             vendor.riskAssessment.riskLevel === 'Medium' ? 'Medium Risk' : 'High Risk'}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </div>
                    )}

                    {/* Column 3: Grade / Status */}
                    {categoryId !== 'blacklist' && (
                      <div className="hidden sm:flex w-24 sm:w-28 shrink-0 flex-col items-center justify-center text-center">
                        {vendor.isSample ? (
                          <>
                            <div className="text-[10px] text-muted-foreground mb-0.5">وضعیت نمونه</div>
                            <Badge 
                              variant={
                                vendor.status === 'approved' ? 'gradeA' :
                                vendor.status === 'conditional' ? 'gradeC' : 'gradeReject'
                              }
                              className="text-[10px] font-bold px-2 py-0"
                            >
                              {vendor.status === 'approved' ? 'Approved' :
                               vendor.status === 'conditional' ? 'Conditional' : 'Reject'}
                            </Badge>
                          </>
                        ) : (
                          <>
                            <div className="text-[10px] text-muted-foreground mb-0.5">رتبه نهایی</div>
                            <GradeBadge grade={vendor.grade} status={vendor.status} scores={vendor.scores} />
                          </>
                        )}
                      </div>
                    )}
                    
                    <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transform group-hover:-translate-x-0.5 transition-all shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
          
          <MaterialsComparisonSection vendors={group.vendors || []} categoryId={categoryId} selection={selection} onSelectSource={onSelectSource} />
        </div>
      </div>
    </Card>
  );
}
