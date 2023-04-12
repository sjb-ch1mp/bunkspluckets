function bunkspluckets(indexerNames, bucketNames, timeFrom, timeTo, showIndexCoverage){
	let includeZeroDurationBuckets = document.getElementById("include_zero_duration_buckets").checked;
	let includeReplicateBuckets = document.getElementById("include_replicate_buckets").checked;
	// Import all directory names as bucket objects
	let atLeastOneLooksLikeBuckets = false;
	let indexers = {};
	for(let i=0; i<indexerNames.length; i++){
		let indexName = (indexerNames[i].endsWith('.txt')) ? indexerNames[i].split('.txt')[0]: indexerNames[i];
		let filesAndDirectories = bucketNames[i].split(/\r?\n/);
		
		//check for ls -laht output
		if(filesAndDirectories.length > 1 && (/^total\s+/.test(filesAndDirectories[0]) || /[drwx\-\.]{11}\s+/.test(filesAndDirectories[1]))){
			//if either of those are true - this is output of ls -laht
			for(let i=0; i<filesAndDirectories.length; i++){
				let fileInfo = filesAndDirectories[i].split(/\s+/);
				filesAndDirectories[i] = fileInfo[fileInfo.length - 1];
			}
		}
		
		let buckets = [];
		for(let j in filesAndDirectories){
			if(looksLikeBucket(filesAndDirectories[j])){
				atLeastOneLooksLikeBuckets = true;
				let bucketSplit = filesAndDirectories[j].split(/_/);
				buckets.push(new Bucket(filesAndDirectories[j], bucketSplit[2], bucketSplit[1], bucketSplit[3], /^rb$/.test(bucketSplit[0])));
			}
		}
		indexers[indexName] = {};
		indexers[indexName]["buckets"] = buckets;
	}
	
	if(!atLeastOneLooksLikeBuckets){
		announceError("Bunkspluckets did not detect any buckets!");
		return;
	}
	
	if(showIndexCoverage){
		let overallMin = null;
		let overallMax = null;
		for(let indexer in indexers){
			let buckets = indexers[indexer]["buckets"];
			buckets.sort((a, b)=>a.min-b.min);
			let indexerMin = buckets[0].min;
			buckets.sort((a, b)=>a.max-b.max);
			let indexerMax = buckets[buckets.length - 1].max;
			if(overallMin == null || indexerMin < overallMin){
				overallMin = indexerMin;
				console.log("Bucket " + buckets[0].uid + " has a minimum of " + buckets[0].min);
			}
			if(overallMax == null || indexerMax > overallMax){
				overallMax = indexerMax;
				console.log("Bucket " + buckets[buckets.length - 1].uid + " has a maximum of " + buckets[buckets.length - 1].max);
			}
		}
		timeFrom = overallMin;
		timeTo = overallMax;
	}
	
	//Filter buckets so that only those that fall within desired timespan remain
	let zeroPercentCoverage = true;
	let filteredIndexers = {};
	for(let indexer in indexers){
		let buckets = indexers[indexer]["buckets"];
		let bucketsClipped = [];
		for(let i in buckets){
			if(!(parseInt(buckets[i].max) <= parseInt(timeFrom) || parseInt(buckets[i].min) >= parseInt(timeTo)) || showIndexCoverage){
				let bucketDuration = parseInt(buckets[i].max) - parseInt(buckets[i].min);
				if(bucketDuration > 0 || (bucketDuration === 0 && includeZeroDurationBuckets)){
					if(!includeReplicateBuckets){
						if(!(buckets[i].isReplicant)){
							bucketsClipped.push(buckets[i]);
						}
					}else{
						bucketsClipped.push(buckets[i]);
					}
				}
			}
		}
		if(bucketsClipped.length > 0){
			zeroPercentCoverage = false;
		}
		filteredIndexers[indexer] = {};
		filteredIndexers[indexer]["buckets"] = bucketsClipped;
		filteredIndexers[indexer]["numClippedBuckets"] = bucketsClipped.length;
		filteredIndexers[indexer]["numBuckets"] = buckets.length;
	}
	if(zeroPercentCoverage){
		announceError("Buckets achieve 0% coverage!");
		return;
	}
	
	//Prepare gaps
	let gaps = null;
	for(let indexer in filteredIndexers){
		//Prepare gaps
		let buckets = filteredIndexers[indexer]["buckets"];
		let runningMin = parseInt(timeFrom);
		buckets.sort((a, b)=> parseInt(a.min)-parseInt(b.min));
		if(filteredIndexers[indexer]["numClippedBuckets"] > 0){
			gaps = [];
			for(let i in buckets){
				if(parseInt(buckets[i].min) > parseInt(runningMin) + 1){
					gaps.push(new Bucket("gap", runningMin, buckets[i].min, "id", false));
				}
				if(runningMin < buckets[i].max){
					runningMin = buckets[i].max;
				}
				if(runningMin >= timeTo){
					break;
				}
			}
			if(runningMin < timeTo){
				gaps.push(new Bucket("gap", runningMin, timeTo, "id", false));
			}
			filteredIndexers[indexer]["gaps"] = gaps;
			filteredIndexers[indexer]["min"] = buckets[0].min;
		}else{
			filteredIndexers[indexer]["gaps"] = [new Bucket("gap", timeFrom, timeTo, "id", false)];
		}
	}
	
	//Build report
	let dateFrom = new Date(parseInt(timeFrom)*1000).toLocaleString().replace(",", "");
	let dateTo = new Date(parseInt(timeTo)*1000).toLocaleString().replace(",", "");
	announceNotification("BUCKET COVERAGE REPORT\n" + makePlotLine(25, "") + "\nFROM: " + dateFrom + "\nTO: " + dateTo);
	let report = formatReportLine("SUMMARY", "heading");
	
	// Show state of user options
	report += formatReportLine("From: " + dateFrom, "subheading");
	report += formatReportLine("To: " + dateTo, "subheading");
	report += formatReportLine("Replicates: " + ((includeReplicateBuckets)?"INCLUDED":"EXCLUDED"), "subheading");
	report += formatReportLine("Zero Duration Buckets: " + ((includeZeroDurationBuckets)?"INCLUDED":"EXCLUDED"), "subheading");
	
	// Plot index coverage
	let totalNumberOfBuckets = 0;
	for(let indexer in filteredIndexers){
		totalNumberOfBuckets += filteredIndexers[indexer]["numClippedBuckets"];
	}
	report += formatReportLine("Total number of buckets to thaw: " + totalNumberOfBuckets, "subheading");
	report += formatReportLine("Plot Units: Less than or equal to " + changeToDuration(0, (parseInt(timeTo)-parseInt(timeFrom))/100), "subheading");
	report += formatReportLine("Coverage Plot:", "subheading");
	report += formatReportLine(getPlotHeader(dateFrom, dateTo) + " INDEXER_NAME [NUM_BUCKETS - COVERAGE]", "");
	
	for(let indexer in filteredIndexers){
		let coverage = calculateCoverage(timeFrom, timeTo, filteredIndexers[indexer]["gaps"], filteredIndexers[indexer]["numClippedBuckets"]);
		if(filteredIndexers[indexer]["numClippedBuckets"] > 0){
			let buckets = filteredIndexers[indexer]["buckets"];
			buckets.sort((a, b)=>parseInt(a.max)-parseInt(b.max));
			filteredIndexers[indexer]["max"] = buckets[buckets.length - 1].max;
			let coveragePlot = getCoveragePlot(timeFrom, timeTo, filteredIndexers[indexer]["min"], filteredIndexers[indexer]["max"], false);
			coveragePlot = addGapsToCoveragePlot(coveragePlot, timeFrom, timeTo, filteredIndexers[indexer]["gaps"]);
			report += formatReportLine(coveragePlot + " " + indexer + " [" + filteredIndexers[indexer]["numClippedBuckets"] + " - " + coverage + "%]", "");
		}else{
			report += formatReportLine("||" + makePlotLine(100, "") + "|| " + indexer + " [" + filteredIndexers[indexer]["numClippedBuckets"] + " - " + coverage + "%]", "");
		}
	}
	report += "\n";
	
	//Add reports for indexers
	report += formatReportLine("INDEXERS", "heading");
	for(let indexer in filteredIndexers){
		gaps = filteredIndexers[indexer]["gaps"];
		buckets = filteredIndexers[indexer]["buckets"];
		
		//Coverage
		report += formatReportLine(indexer, "subheading");
		report += formatReportLine("Applicable buckets: " + filteredIndexers[indexer]["numClippedBuckets"] + "/" + filteredIndexers[indexer]["numBuckets"], "");	
		report += formatReportLine("Coverage: " + calculateCoverage(timeFrom, timeTo, gaps, buckets.length) + "%", "");
		
		//Gaps
		if(buckets.length === 0){
			report += formatReportLine("Gaps: N/A", "");
		}else if(gaps.length > 0){
			report += formatReportLine("Gaps:", "");
			report += formatReportLine(getPlotHeader(dateFrom, dateTo) + " GAP_START_DATE_TIME [GAP_DURATION]", "");
			gaps.sort((a, b)=>parseInt(a.min)-parseInt(b.min));
			for(let i in gaps){
				let appendMe = epochTimeToLocal(gaps[i].min) + " [" + changeToDuration(gaps[i].min, gaps[i].max) + "]";
				report += formatReportLine(getCoveragePlot(timeFrom, timeTo, gaps[i].min, gaps[i].max, false) + " " + appendMe, "");
			}
		}else{
			report += formatReportLine("Gaps: No gaps", "");
		}
		
		//Plot bucket coverage
		let plotAllCoverage = document.getElementById("show_all_coverage").checked;
		if(plotAllCoverage){
			if(filteredIndexers[indexer]["numClippedBuckets"] === 0){
				report += formatReportLine("Bucket Plot: N/A", "");	
			}else{
				report += formatReportLine("Bucket Plot:", "");
				report += formatReportLine(getPlotHeader(dateFrom, dateTo) + " BUCKET_FROM_DATE_TIME [BUCKET_ID] [BUCKET_DURATION](*REPLICATE)", "");
				buckets.sort((a, b)=> parseInt(a.min)-parseInt(b.min));
				for(let i in buckets){
					report += formatReportLine(getCoveragePlot(timeFrom, timeTo, buckets[i].min, buckets[i].max) + " " + 
						epochTimeToLocal(buckets[i].min) + " [" + 
						buckets[i].uid + "] [" + 
						changeToDuration(buckets[i].min, buckets[i].max) + "]" + 
						((buckets[i].isReplicant)?"*":""), "");
				}	
			}			
		}
		report += "\n";
	}
	report += "\n";
	
	outputResults(report);
	
	//create csv
	let csv = 'indexer,bucket\n';
	for(let indexer in filteredIndexers){
		let buckets = filteredIndexers[indexer]["buckets"];
		for(let i in buckets){
			csv += indexer + "," + buckets[i].name + "\n";
		}
	}
	
	if(!showIndexCoverage){
		lastBucketList = {"name":"bunkspluckets_bucket-list_" + timeFrom + "-" + timeTo + ".csv", "contents":[csv]};
	}
	lastReport = {"name":"bunkspluckets_coverage-report_" + timeFrom + "-" + timeTo + ".txt", "contents":[report]};
}

function epochTimeToLocal(epochTime){
	return new Date(parseInt(epochTime)*1000).toLocaleString().replace(",","");
}

function changeToDuration(from, to){
	let duration = '';
	let diff = parseInt(to) - parseInt(from);
	if(diff >= 86400){//format with days
		let days = parseInt(diff / 86400);
		let hours = parseInt((diff % 86400) / 3600);
		let minutes = parseInt(((diff % 86400) % 3600) / 60);
		let seconds = parseInt(((diff % 86400) % 3600) % 60);
		duration = days + "d " + hours + "h " + minutes + "m " + seconds + "s";
	}else if(diff >= 3600){//format with minutes
		let hours = parseInt(diff / 3600);
		let minutes = parseInt((diff % 3600) / 60);
		let seconds = parseInt(((diff % 3600) % 60));
		duration = hours + "h " + minutes + "m " + seconds + "s";
	}else if(diff >= 60){
		let minutes = parseInt(diff / 60);
		let seconds = parseInt(diff % 60);
		duration = minutes + "m " + seconds + "s";
	}else{
		duration = diff + "s";
	}
	return duration;
}

function getPlotHeader(from, to){
	let gap = 100 - (from.length + to.length);
	let plotLine = makePlotLine(gap, "");
	return "||" + from + plotLine + to + "||";
}

function addGapsToCoveragePlot(coveragePlot, from, to, gaps){
	coveragePlot = coveragePlot.split("");
	if(gaps.length > 0){
		let gapCoveragePlots = [];
		for(let i in gaps){
			gapCoveragePlots.push(getCoveragePlot(from, to, gaps[i].min, gaps[i].max, false));
		}
		for(let i in gapCoveragePlots){
			for(let j=0; j<gapCoveragePlots[i].length; j++){
				if(gapCoveragePlots[i].charAt(j) === "#"){ //CHANGED
					coveragePlot[j] = "-";
				}
			}
		}
	}
	return coveragePlot.join("");
}

function getCoveragePlot(from, to, bucketFrom, bucketTo, gaps){
	let plot = "";
	let totalSpan = parseInt(to) - parseInt(from);
	
	if(parseInt(bucketFrom) < parseInt(from) && parseInt(bucketTo) > parseInt(to)){
		plot += makePlotLine(100, "fill");
	}else if(parseInt(bucketFrom) < parseInt(from)){
		fillLength = getPercLength(totalSpan, parseInt(from), parseInt(bucketTo));
		blankLength = getPercLength(totalSpan, parseInt(bucketTo), parseInt(to));
		if(fillLength === 0){
			blankLength--;
			fillLength++;
		}
		plot += makePlotLine(fillLength, ((gaps)?"gaps":"fill"));
		plot += makePlotLine(blankLength, "");
	}else if(parseInt(bucketTo) > parseInt(to)){
		blankLength = getPercLength(totalSpan, parseInt(from), parseInt(bucketFrom));
		fillLength = getPercLength(totalSpan, parseInt(bucketFrom), parseInt(to));
		if(fillLength === 0){
			blankLength--;
			fillLength++;
		}
		plot += makePlotLine(blankLength, "");
		plot += makePlotLine(fillLength, ((gaps)?"gaps":"fill"));
	}else{
		blankLengthFirst = getPercLength(totalSpan, parseInt(from), parseInt(bucketFrom));
		fillLength = getPercLength(totalSpan, parseInt(bucketFrom), parseInt(bucketTo));
		blankLengthLast = getPercLength(totalSpan, parseInt(bucketTo), parseInt(to));
		if(fillLength === 0){
			if(blankLengthFirst > blankLengthLast){
				blankLengthFirst--;
			}else{
				blankLengthLast--;
			}
			fillLength++;
		}
		plot += makePlotLine(blankLengthFirst, "");
		plot += makePlotLine(fillLength, ((gaps)?"gaps":"fill"));
		plot += makePlotLine(blankLengthLast, "");
	}
	
	if(plot.length === 99){
		plot += (plot.charAt(98) === "-") ? "-": "#";
	}else if(plot.length === 101){
		plot = (plot.charAt(100) === "#") ? plot.substring(0, plot.length - 2) + "#": plot.substring(0, plot.length - 1);
	}
	
	return "||" + plot + "||";
}

function getPercLength(totalSpan, from, to){
	let innerSpan = to - from;
	return Math.round((innerSpan/totalSpan)*100, 0);
}

function makePlotLine(len, type){
	let plotLine = '';
	for(let i=0; i<len; i++){
		if(type === "fill"){
			plotLine += "#";
		}else if(type === "divider"){
			plotLine += "_";
		}else if(type === "gaps"){
			plotLine += "*";
		}else{
			plotLine += "-";
		}
	}
	return plotLine;
}

function calculateCoverage(timeFrom, timeTo, gaps, numBuckets){
	if(numBuckets === 0){
		return "0";
	}else if(gaps.length === 0){
		return "100"
	}else{
		let totalTimeSpan = parseInt(timeTo) - parseInt(timeFrom);
		let totalGaps = 0;
		for(let i in gaps){
			totalGaps += parseInt(gaps[i].max) - parseInt(gaps[i].min);
		}
		return Math.round(((totalTimeSpan - totalGaps) / totalTimeSpan) * 100, 0);
	}
}

class Bucket{
	constructor(name, min, max, uid, isReplicant){
		this.name = name;
		this.min = min;
		this.max = max;
		this.uid = uid;
		this.isReplicant = isReplicant;
	}
}

function formatReportLine(line, type){
	if(type === "heading"){
		return "|\n|\n|" + makePlotLine(53, "divider") + line.toUpperCase() + makePlotLine(54 - line.length, "divider") + "\n\n";
	}else if(type === "subheading"){
		return "[*] " + line + "\n";
	}else if(type === "script"){
		return line + "\n";
	}else{
		return "|__ " + line + "\n";
	}
}

function generateCopyItemScript(buckets){
	let script = "mkdir BunkSplunketsTemp;`\n$Buckets=";
	for(let i=0; i<buckets.length; i++){
		if(i === buckets.length - 1){
			script += "\"" + buckets[i].name + "\";`\n"
		}else{
			script += "\"" + buckets[i].name + "\",`\n"
		}
	}
	script += "echo $Buckets |`\n";
	script += "foreach-object {copy-item -path $_ -destination BunkSplucketsTemp -recurse -erroraction Stop}";
	return script;
}

function looksLikeBucket(name){
	return /^(db_|rb_)/.test(name) && name.split('_').length === 5 && !(/sentinel$/.test(name));
}

function looksLikeEpochTime(time){
	return time != undefined && /^[0-9]+$/.test(time);
}

function outputResults(resultString){
	let results = document.getElementById("results");
	results.innerText = resultString;
}

function announceError(msg){
	let announcement = document.getElementById("announcement");
	announcement.setAttribute("style","background-color: red;");
	announcement.innerText = msg;
}

function announceNotification(msg){
	let announcement = document.getElementById("announcement");
	announcement.setAttribute("style","background-color: #7397B2;");
	announcement.innerText = msg;
}

function hideAnnouncement(){
	let announcement = document.getElementById("announcement");
	announcement.innerText = "";
}

function downloadResults(filename, results){	
	let blob = new Blob(results, {type: "text/csv"});
	let element = window.document.createElement('a');
	element.href = window.URL.createObjectURL(blob);
	element.download = filename;
	document.body.appendChild(element);
	element.click();
	document.body.removeChild(element);
}
