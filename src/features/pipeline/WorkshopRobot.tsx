import type { WorkshopActivity } from './workshop-view';
export type RobotTool = 'wrench' | 'brush' | 'lens' | 'pencil';
export function WorkshopRobot({ tool = 'wrench', small = false, activity = 'build' }: { tool?: RobotTool; small?: boolean; activity?: WorkshopActivity ;}) {
  return <svg className={`workshop-robot ${small ? 'small' : ''}`} viewBox={small ? "0 0 240 280" : "0 0 340 280"} fill="none" aria-hidden="true">
    <ellipse cx="120" cy="265" rx="73" ry="11" fill="var(--palette-134)" opacity=".6" />
    {!small && <g className="robot-work-surface">
      <path d="M218 155L207 257M302 155L317 257" stroke="var(--palette-135)" strokeWidth="7" strokeLinecap="round" />
      <path d="M195 163H326" stroke="var(--palette-136)" strokeWidth="7" strokeLinecap="round" />
      {activity === 'design' && <>
        <rect x="183" y="64" width="144" height="96" rx="5" fill="var(--palette-137)" stroke="var(--palette-138)" strokeWidth="5" />
        <rect x="192" y="73" width="126" height="78" rx="2" fill="var(--palette-139)" />
        <path d="M202 87H270" stroke="var(--palette-140)" strokeWidth="9" strokeLinecap="round" />
        <path className="design-stroke stroke-one" d="M202 107H299" stroke="var(--palette-141)" strokeWidth="16" strokeLinecap="round" pathLength="1" />
        <path className="design-stroke stroke-two" d="M202 133H246" stroke="var(--palette-142)" strokeWidth="14" strokeLinecap="round" pathLength="1" />
        <path className="design-stroke stroke-three" d="M268 133H301" stroke="var(--palette-143)" strokeWidth="14" strokeLinecap="round" pathLength="1" />
        <ellipse cx="292" cy="187" rx="29" ry="18" fill="var(--palette-144)" />
        <circle cx="278" cy="184" r="5" fill="var(--palette-141)" /><circle cx="293" cy="178" r="5" fill="var(--palette-142)" /><circle cx="306" cy="186" r="5" fill="var(--palette-143)" />
      </>}
      {activity === 'build' && <>
        <rect x="193" y="98" width="123" height="61" rx="7" fill="var(--palette-145)" stroke="var(--palette-146)" strokeWidth="3" />
        <g className="assembly-block"><rect x="216" y="70" width="77" height="29" rx="4" fill="var(--palette-147)" /><path d="M231 80H279" stroke="var(--palette-148)" strokeWidth="3" /></g>
        <circle className="assembly-bolt" cx="205" cy="113" r="7" fill="var(--palette-149)" /><path d="M201 113H209" stroke="var(--palette-150)" strokeWidth="2" />
        <path d="M231 119H302M231 137H278" stroke="var(--palette-151)" strokeWidth="6" strokeLinecap="round" />
        <g className="assembly-sparks" stroke="var(--palette-152)" strokeWidth="3" strokeLinecap="round"><path d="M201 91L199 83M215 94L221 88M190 99L182 96" /></g>
        <rect x="273" y="184" width="25" height="16" rx="3" fill="var(--palette-146)" /><rect x="248" y="198" width="31" height="17" rx="3" fill="var(--palette-153)" />
      </>}
      {(activity === 'plan' || activity === 'write') && <>
        <rect x="185" y="68" width="142" height="92" rx="4" fill={activity === 'plan' ? 'var(--palette-154)' : 'var(--palette-155)'} stroke="var(--palette-156)" strokeWidth="4" />
        {activity === 'plan' ? <>
          <path d="M199 80V148M218 80V148M237 80V148M256 80V148M275 80V148M294 80V148M313 80V148M197 90H316M197 109H316M197 128H316M197 147H316" stroke="var(--palette-157)" strokeWidth=".7" />
          <path className="plan-lines" d="M202 86H239V112H202ZM239 99H265V134H298M265 86H309V112H265M202 131H239V147H202" stroke="var(--palette-158)" strokeWidth="2.5" pathLength="1" />
          <path d="M253 177L308 187L305 197L250 187Z" fill="var(--palette-159)" /><path d="M260 180L259 186M272 182L271 188M284 184L283 190M296 187L295 193" stroke="var(--palette-160)" />
        </> : <>
          <path className="writing-lines" d="M201 88H306M201 104H284M201 120H302M201 136H270" stroke="var(--palette-161)" strokeWidth="3" strokeLinecap="round" pathLength="1" />
          <path d="M193 177H285L298 204H205Z" fill="var(--palette-147)" /><path d="M210 185H277M215 194H282" stroke="var(--palette-162)" strokeWidth="3" />
        </>}
      </>}
      {activity === 'inspect' && <>
        <rect x="185" y="68" width="142" height="92" rx="7" fill="var(--palette-163)" stroke="var(--palette-164)" strokeWidth="4" />
        <path d="M201 91H309M201 113H309M201 135H309" stroke="var(--palette-165)" strokeWidth="10" />
        <g fill="var(--palette-166)"><circle cx="205" cy="91" r="4" /><circle cx="205" cy="113" r="4" /><circle cx="205" cy="135" r="4" /></g>
        <path d="M222 91H296M222 113H277M222 135H289" stroke="var(--palette-167)" strokeWidth="3" />
        <path className="inspection-scan" d="M194 80H318" stroke="var(--palette-168)" strokeWidth="3" opacity=".8" />
      </>}
    </g>}
    <g className="robot-body">
      <g className="robot-legs" stroke="var(--palette-169)" strokeWidth="14"><path d="M98 217V247M143 217V247" /></g>
      <path d="M72 251Q72 242 85 242H105V260H72ZM135 242H155Q168 242 168 251V260H135Z" fill="currentColor" stroke="var(--palette-170)" strokeWidth="3" />
      <g className="robot-left-arm"><path d="M75 163L51 183L48 212" stroke="var(--palette-171)" strokeWidth="15" strokeLinecap="round" /><circle cx="51" cy="183" r="10" fill="var(--palette-172)" stroke="currentColor" strokeWidth="4" /><path d="M38 213V224M48 213V227M58 213V224" stroke="currentColor" strokeWidth="7" strokeLinecap="round" /></g>
      <g className="robot-tool-arm"><path d="M167 161L191 181L212 158" stroke="var(--palette-171)" strokeWidth="15" strokeLinecap="round" /><circle cx="191" cy="181" r="10" fill="var(--palette-172)" stroke="currentColor" strokeWidth="4" />
        <g className="robot-held-tool">
          {tool === 'wrench' && <><path d="M209 160L198 119" stroke="var(--palette-173)" strokeWidth="9" strokeLinecap="round" /><path d="M197 123Q179 120 186 102L193 112L203 109L205 97Q219 111 204 122" fill="var(--palette-173)" /><path d="M207 144L211 158" stroke="var(--palette-174)" strokeWidth="5" strokeLinecap="round" /></>}
          {tool === 'brush' && <><path d="M211 159L201 119" stroke="var(--palette-175)" strokeWidth="9" strokeLinecap="round" /><path d="M195 121L190 105L207 100L212 117Z" fill="var(--palette-176)" /><path d="M190 106L184 85Q196 91 201 80L207 101Z" fill="var(--palette-177)" /></>}
          {tool === 'pencil' && <><path d="M211 159L197 98" stroke="var(--palette-178)" strokeWidth="7" strokeLinecap="round" /><path d="M194 98L195 85L201 96Z" fill="var(--palette-179)" /><path d="M195 85L194 92L198 91Z" fill="var(--palette-180)" /></>}
          {tool === 'lens' && <><path d="M213 160L204 134" stroke="var(--palette-173)" strokeWidth="8" strokeLinecap="round" /><circle cx="196" cy="114" r="23" fill="var(--palette-181)" stroke="var(--palette-173)" strokeWidth="6" /><path d="M184 111Q184 102 194 101" stroke="var(--palette-182)" strokeWidth="3" strokeLinecap="round" /></>}
        </g><circle cx="211" cy="159" r="9" fill="currentColor" />
      </g>
      <rect x="77" y="142" width="90" height="86" rx="27" fill="currentColor" stroke="var(--palette-183)" strokeWidth="3" />
      <path d="M87 154Q120 163 157 154" stroke="var(--illustration-highlight)" opacity=".23" strokeWidth="3" />
      <rect x="93" y="170" width="58" height="37" rx="12" fill="var(--palette-184)" />
      <path className="robot-heart" d="M122 196L111 186Q106 177 115 177Q120 177 122 181Q125 177 130 177Q138 178 133 186Z" fill="currentColor" />
      <circle cx="103" cy="216" r="2.5" fill="var(--palette-183)" /><circle cx="141" cy="216" r="2.5" fill="var(--palette-183)" />
      <path d="M109 142V130H134V142" fill="var(--palette-185)" />
      <g className="robot-head">
        <path d="M121 36V20L132 13" stroke="var(--palette-186)" strokeWidth="5" strokeLinecap="round" /><circle className="robot-antenna" cx="134" cy="11" r="7" fill="currentColor" />
        <rect x="43" y="66" width="18" height="37" rx="8" fill="var(--palette-185)" /><rect x="181" y="66" width="18" height="37" rx="8" fill="var(--palette-185)" />
        <rect x="54" y="33" width="134" height="103" rx="35" fill="currentColor" stroke="var(--palette-183)" strokeWidth="3" />
        <path d="M75 44Q119 35 165 44" stroke="var(--illustration-highlight)" opacity=".3" strokeWidth="4" strokeLinecap="round" />
        <rect x="66" y="52" width="110" height="64" rx="24" fill="var(--palette-187)" />
        <path d="M78 61H99" stroke="var(--palette-188)" opacity=".16" strokeWidth="4" strokeLinecap="round" />
        <g className="robot-gaze"><g className="robot-eyes" fill="currentColor"><rect x="86" y="72" width="15" height="23" rx="7.5" /><rect x="141" y="72" width="15" height="23" rx="7.5" /></g><path className="robot-smile" d="M113 102Q121 110 130 102" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path className="robot-concern" d="M113 106Q121 100 130 106" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></g>
        <ellipse cx="81" cy="100" rx="6" ry="3" fill="currentColor" opacity=".2" /><ellipse cx="161" cy="100" rx="6" ry="3" fill="currentColor" opacity=".2" />
      </g>
    </g>
  </svg>;
}
