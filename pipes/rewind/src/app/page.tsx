"use client";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Loader2, RotateCcw, AlertCircle } from "lucide-react";
import { AudioTranscript } from "@/components/timeline/audio-transcript";
import { AIPanel } from "@/components/timeline/ai-panel";
import { TimelineProvider } from "@/lib/hooks/use-timeline-selection";
import { throttle } from "lodash";
import { AGENTS } from "@/components/timeline/agents";
import { TimelineControls } from "@/components/timeline/timeline-controls";
import { addDays, isAfter, isSameDay, subDays } from "date-fns";
import { getStartDate } from "@/lib/actions/get-start-date";
import { useTimelineData } from "@/lib/hooks/use-timeline-data";
import { useCurrentFrame } from "@/lib/hooks/use-current-frame";
import { TimelineSlider } from "@/components/timeline/timeline";
import { useTimelineStore } from "@/lib/hooks/use-timeline-store";
import { hasFramesForDate } from "@/lib/actions/has-frames-date";
import { CommandShortcut } from "@/components/ui/command";
import { CurrentFrameTimeline } from "@/components/current-frame-timeline";

export interface StreamTimeSeriesResponse {
	timestamp: string;
	devices: DeviceFrameResponse[];
}

export interface DeviceFrameResponse {
	device_id: string;
	frame_id: string;
	frame: string; // base64 encoded image
	metadata: DeviceMetadata;
	audio: AudioData[];
}

export interface DeviceMetadata {
	file_path: string;
	app_name: string;
	window_name: string;
	ocr_text: string;
	timestamp: string;
}

export interface AudioData {
	device_name: string;
	is_input: boolean;
	transcription: string;
	audio_file_path: string;
	duration_secs: number;
	start_offset: number;
}

export interface TimeRange {
	start: Date;
	end: Date;
}

// Add this easing function at the top level
const easeOutCubic = (x: number): number => {
	return 1 - Math.pow(1 - x, 3);
};

export default function Timeline() {
	const [currentIndex, setCurrentIndex] = useState(0);
	const [isAiPanelExpanded, setIsAiPanelExpanded] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [aiPanelPosition, setAiPanelPosition] = useState({ x: 0, y: 0 });
	// const [searchResults, setSearchResults] = useState<number[]>([]);
	const [startAndEndDates, setStartAndEndDates] = useState<TimeRange>({
		start: new Date(new Date().setHours(0, 0, 0, 0)),
		end: new Date(),
	});

	const { currentFrame, setCurrentFrame } = useCurrentFrame((index) => {
		setCurrentIndex(index);
	});

	const { currentDate, setCurrentDate, fetchTimeRange, hasDateBeenFetched } =
		useTimelineStore();

	const { frames, isLoading, error, message, fetchNextDayData } =
		useTimelineData(currentDate, (frame) => {
			setCurrentFrame(frame);
		});

	useEffect(() => {
		const getStartDateAndSet = async () => {
			const data = await getStartDate();
			if (!("error" in data)) {
				setStartAndEndDates((prev) => ({
					...prev,
					start: data,
				}));
			}
		};

		getStartDateAndSet();
	}, []);

	useEffect(() => {
		setAiPanelPosition({
			x: window.innerWidth - 400,
			y: window.innerHeight / 4,
		});
	}, []);

	useEffect(() => {
		const startTime = new Date(currentDate);
		startTime.setHours(0, 0, 0, 0);

		const endTime = new Date(currentDate);
		if (endTime.getDate() === new Date().getDate()) {
			endTime.setMinutes(endTime.getMinutes() - 5);
		} else {
			endTime.setHours(23, 59, 59, 999);
		}
		fetchTimeRange(startTime, endTime);
	}, [currentDate]);

	useEffect(() => {
		if (currentFrame) {
			const frameDate = new Date(currentFrame.timestamp);
			if (!isSameDay(frameDate, currentDate)) {
				setCurrentDate(frameDate);
			}
		}
	}, [currentFrame, currentDate]);

	const handleScroll = useMemo(
		() =>
			throttle(
				(e: WheelEvent) => {
					// Move these checks outside the throttle to improve performance
					const isWithinAiPanel =
						e.target instanceof Node &&
						document.querySelector(".ai-panel")?.contains(e.target);
					const isWithinAudioPanel =
						e.target instanceof Node &&
						document
							.querySelector(".audio-transcript-panel")
							?.contains(e.target);
					const isWithinTimelineDialog =
						e.target instanceof Node &&
						document.querySelector('[role="dialog"]')?.contains(e.target);

					if (isWithinAiPanel || isWithinAudioPanel || isWithinTimelineDialog) {
						return;
					}

					e.preventDefault();
					e.stopPropagation();

					// Calculate scroll intensity based on absolute delta
					const scrollIntensity = Math.abs(e.deltaY);
					const direction = -Math.sign(e.deltaY);

					// Change this if you want limit the index change
					const limitIndexChange = Infinity;

					// Adjust index change based on scroll intensity
					const indexChange =
						direction *
						Math.min(
							limitIndexChange,
							Math.ceil(Math.pow(scrollIntensity / 50, 1.5)),
						);

					requestAnimationFrame(() => {
						setCurrentIndex((prevIndex) => {
							const newIndex = Math.min(
								Math.max(0, Math.floor(prevIndex + indexChange)),
								frames.length - 1,
							);

							if (newIndex !== prevIndex && frames[newIndex]) {
								setCurrentFrame(frames[newIndex]);
							}

							return newIndex;
						});
					});
				},
				16,
				{ leading: true, trailing: false },
			),
		[frames], // Only depend on frames length changes
	);

	useEffect(() => {
		const preventScroll = (e: WheelEvent) => {
			const isWithinAiPanel = document
				.querySelector(".ai-panel")
				?.contains(e.target as Node);
			const isWithinAudioPanel = document
				.querySelector(".audio-transcript-panel")
				?.contains(e.target as Node);
			const isWithinTimelineDialog = document
				.querySelector('[role="dialog"]')
				?.contains(e.target as Node);

			if (!isWithinAiPanel && !isWithinAudioPanel && !isWithinTimelineDialog) {
				e.preventDefault();
			}
		};

		document.addEventListener("wheel", preventScroll, { passive: false });
		return () => document.removeEventListener("wheel", preventScroll);
	}, []);

	const handleRefresh = () => {
		window.location.reload();
	};

	useEffect(() => {
		const container = containerRef.current;
		if (container) {
			container.addEventListener("wheel", handleScroll, { passive: false });
		}

		return () => {
			if (container) {
				container.removeEventListener("wheel", handleScroll);
			}
		};
	}, [handleScroll]);

	const jumpToTime = (targetDate: Date) => {
		// Find the closest frame to the target date
		if (frames.length === 0) return;

		const targetTime = targetDate.getTime();
		let closestIndex = 0;
		let closestDiff = Infinity;

		frames.forEach((frame, index) => {
			const frameTime = new Date(frame.timestamp).getTime();
			const diff = Math.abs(frameTime - targetTime);
			if (diff < closestDiff) {
				closestDiff = diff;
				closestIndex = index;
			}
		});

		// Update cursor position
		setCurrentIndex(closestIndex);
		if (frames[closestIndex]) {
			setCurrentFrame(frames[closestIndex]);
			//	setCurrentDate(new Date(frames[closestIndex].timestamp));
		}
	};

	const handleDateChange = async (newDate: Date) => {
		const checkFramesForDate = await hasFramesForDate(newDate);

		if (!checkFramesForDate) {
			let subDate;
			if (isAfter(currentDate, newDate)) {
				subDate = subDays(newDate, 1);
			} else {
				subDate = addDays(newDate, 1);
			}

			return await handleDateChange(subDate);
		}

		if (!hasDateBeenFetched(newDate)) {
			setCurrentFrame(null);
			const frameTimeStamp = new Date(newDate);
			console.log(
				frameTimeStamp.getDate() === new Date(currentDate).getDate(),
				startAndEndDates.start.getDate(),
				newDate.getDate(),
			);
			if (isSameDay(frameTimeStamp, new Date(currentDate))) {
				return;
			}

			if (isAfter(startAndEndDates.start, newDate)) {
				return;
			}

			setCurrentDate(newDate);
		} else {
			jumpToTime(newDate);
		}
	};

	const handleJumpToday = () => {
		window.location.reload();
	};

	const animateToIndex = (targetIndex: number, duration: number = 1000) => {
		const startIndex = currentIndex;
		const startTime = performance.now();

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);

			// Apply easing
			const easedProgress = easeOutCubic(progress);

			// Calculate the current position
			const newIndex = Math.round(
				startIndex + (targetIndex - startIndex) * easedProgress,
			);

			// Update the frame
			setCurrentIndex(newIndex);
			if (frames[newIndex]) {
				setCurrentFrame(frames[newIndex]);
			}

			// Continue animation if not complete
			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		requestAnimationFrame(animate);
	};

	return (
		<TimelineProvider>
			<div
				ref={containerRef}
				className="inset-0 flex flex-col bg-background text-foreground relative"
				style={{
					height: "100vh",
					overscrollBehavior: "none",
					WebkitUserSelect: "none",
					userSelect: "none",
					MozUserSelect: "none",
					msUserSelect: "none",
				}}
			>
				<div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
					<div className="flex items-center gap-4">
						<TimelineControls
							currentDate={currentDate}
							startAndEndDates={startAndEndDates}
							onDateChange={handleDateChange}
							onJumpToday={handleJumpToday}
							className="shadow-lg"
						/>
						{/* <TimelineSearch2
              frames={frames}
              onResultSelect={animateToIndex}
              onSearchResults={setSearchResults}
            /> */}
						<div>
							<CommandShortcut>⌘K</CommandShortcut>{" "}
							<span className="text-xs text-muted-foreground">to search</span>
						</div>
					</div>
				</div>

				<div className="flex-1 relative min-h-0">
					{isLoading && (
						<div className="absolute inset-0 flex items-center justify-center backdrop-blur-sm">
							<div className="bg-background/95 p-6 border rounded-xl shadow-lg text-center space-y-3 max-w-md mx-4">
								<h3 className="font-medium">Loading Timeline</h3>
								<p className="text-sm text-muted-foreground">
									Fetching your recorded frames...
								</p>
								<Loader2 className="h-5 w-5 animate-spin mx-auto mt-2" />
							</div>
						</div>
					)}

					{!error && message && (
						<div className="absolute inset-0 flex items-center justify-center backdrop-blur-sm">
							<div className="bg-background/95 p-6 border rounded-xl shadow-lg text-center space-y-3 max-w-md mx-4">
								<h3 className="font-medium">Processing</h3>
								<p className="text-sm text-muted-foreground">{message}</p>
								<Loader2 className="h-5 w-5 animate-spin mx-auto mt-2" />
							</div>
						</div>
					)}

					{error && (
						<div className="absolute inset-0 flex items-center justify-center backdrop-blur-sm">
							<div className="bg-destructive/5 p-6 border-destructive/20 border rounded-xl text-center space-y-4 max-w-md mx-4">
								<div className="flex flex-col items-center gap-2">
									<AlertCircle className="h-6 w-6 text-destructive" />
									<h3 className="font-medium text-destructive">
										Connection Error
									</h3>
								</div>
								<p className="text-sm text-muted-foreground">
									Unable to reach your screenpipe data. Please verify that the
									screenpipe turned on.
								</p>
								<button
									onClick={handleRefresh}
									className="flex items-center gap-2 px-4 py-2 bg-background hover:bg-muted transition-colors rounded-lg border border-input mx-auto"
								>
									<RotateCcw className="h-4 w-4" />
									<span>Reload Timeline</span>
								</button>
							</div>
						</div>
					)}
					{currentFrame && <CurrentFrameTimeline currentFrame={currentFrame} />}
					{currentFrame && (
						<AudioTranscript
							frames={frames}
							currentIndex={currentIndex}
							groupingWindowMs={30000} // 30 seconds window
						/>
					)}
				</div>

				<TimelineSlider
					frames={frames}
					currentIndex={currentIndex}
					onFrameChange={(index) => {
						setCurrentIndex(index);
						if (frames[index]) {
							setCurrentFrame(frames[index]);
						}
					}}
					fetchNextDayData={fetchNextDayData}
					currentDate={currentDate}
					startAndEndDates={startAndEndDates}
				/>

				<AIPanel
					position={aiPanelPosition}
					onPositionChange={setAiPanelPosition}
					onClose={() => {
						setIsAiPanelExpanded(false);
					}}
					frames={frames}
					agents={AGENTS}
					isExpanded={isAiPanelExpanded}
					onExpandedChange={setIsAiPanelExpanded}
				/>

				<div className="fixed left-12 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
					<div className="flex flex-col items-center gap-1">
						<span>▲</span>
						<span>scroll</span>
						<span>▼</span>
					</div>
				</div>
			</div>
		</TimelineProvider>
	);
}
