import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  getActivities,
  getActivityStatus,
  handleExport,
  handleImport,
  putActivity,
  Status,
  useDeleteActivity,
} from "./services/tasks";
import { Link, useParams } from "react-router-dom";
import { useSwipeable } from "react-swipeable";
import { googleLogout, useGoogleLogin } from "@react-oauth/google";
import { getFileFromDrive, postStringToDrive } from "./services/drive";
import { mergeArraysById } from "./utils/array";
import { clearAuthCookie, getAuthCookie } from "./utils/cookie";

function emotionColorAndEmoji(percent: number) {
  percent = Math.max(0, Math.min(100, percent)); // Clamp between 0 and 100

  let r, g, b;

  if (percent <= 50) {
    // Transition from Red (#FF6B6B) to Blue (#6B92FF)
    const start = { r: 255, g: 107, b: 107 }; // Red
    const mid = { r: 107, g: 146, b: 255 }; // Blue

    const ratio = percent / 50;
    r = Math.round(start.r + (mid.r - start.r) * ratio);
    g = Math.round(start.g + (mid.g - start.g) * ratio);
    b = Math.round(start.b + (mid.b - start.b) * ratio);
  } else {
    // Transition from Blue (#6B92FF) to Green (#6BCB77)
    const mid = { r: 107, g: 146, b: 255 }; // Blue
    const end = { r: 107, g: 203, b: 119 }; // Green

    const ratio = (percent - 50) / 50;
    r = Math.round(mid.r + (end.r - mid.r) * ratio);
    g = Math.round(mid.g + (end.g - mid.g) * ratio);
    b = Math.round(mid.b + (end.b - mid.b) * ratio);
  }

  // Emoji Scale
  let emoji;
  if (percent <= 10)
    emoji = "😢"; // Very sad
  else if (percent <= 25)
    emoji = "😞"; // Sad
  else if (percent <= 40)
    emoji = "😐"; // Neutral-Sad
  else if (percent <= 50)
    emoji = "😶"; // Neutral (Blue zone)
  else if (percent <= 60)
    emoji = "🙂"; // Slightly happy
  else if (percent <= 75)
    emoji = "😊"; // Happy
  else if (percent <= 90)
    emoji = "😄"; // Very happy
  else emoji = "😁"; // Super happy

  return { color: `rgb(${r}, ${g}, ${b})`, emoji, score: percent };
}

function Project() {
  const { tag = "" } = useParams();

  const { data: activities } = useQuery({
    queryKey: ["projects", "activities"],
    queryFn: getActivities,
    select: (data) => {
      return data
        .sort((a, b) => {
          if (!a || !b) return 0;

          // If statuses are the same, sort by createdAt (earliest first)
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        })
        .filter((doc) => !doc.deleted);
    },
  });
  const [google, setGoogle] = useState<string>(getAuthCookie());

  useEffect(() => {
    const interval = setInterval(() => {
      setGoogle(getAuthCookie());
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, []);
  const mood = useMemo(
    () =>
      emotionColorAndEmoji(
        Math.min(
          100,
          ((activities || [])
            .filter((a) =>
              a.finishedOn?.includes(new Date().toLocaleDateString("en-CA"))
            )
            .reduce((acc, a) => acc + (a.estimation || 0), 0) *
            100) /
            5
        )
      ),
    [activities]
  );

  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const sync = useCallback(
    async (access_token: string) => {
      setIsSyncing(true);
      try {
        const fileName = "progress-tracker-activities-readonly.json";
        if (!access_token) return;
        const { data, fileId } = await getFileFromDrive({
          accessToken: access_token,
          fileName,
        });
        const localData = await handleExport();
        const finalData = mergeArraysById(data, localData);
        await postStringToDrive({
          json: JSON.stringify(finalData),
          accessToken: access_token,
          fileName,
          fileId,
        });
        await handleImport({ data: finalData });
        queryClient.invalidateQueries({
          queryKey: ["projects", "activities"],
        });
      } catch (e) {
        console.error("Error syncing:", e);
      } finally {
        setIsSyncing(false);
      }
    },
    [queryClient]
  );
  const filteredActivities = useMemo(
    () =>
      (activities || []).filter((activity) =>
        tag ? activity.tag === tag : true
      ),
    [activities, tag]
  );
  useEffect(() => {
    document.body.style.backgroundColor = mood.color;
  }, [mood]);
  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      const expiryDate = new Date(
        Date.now() + tokenResponse.expires_in * 1000
      ).toUTCString();
      document.cookie = `access_token=${tokenResponse.access_token}; expires=${expiryDate}; path=/; Secure; SameSite=Lax`;
      setGoogle(tokenResponse.access_token);
      sync(tokenResponse.access_token);
    },
    scope: "https://www.googleapis.com/auth/drive.file",
  });
  if (!activities) return <div>Loading...</div>;
  return (
    <>
      <div className="container mx-auto my-4 p-6 bg-white bg-opacity-30 rounded-lg select-none">
        {/* Form Section */}
        <div className="flex flex-row items-center justify-between rounded-2xl ">
          <MoodCard {...mood} />

          <div className="flex gap-4 flex-row">
            {google && (
              <button
                onClick={() => sync(google)} // Replace with your actual sync function
                className="relative px-5 py-2 rounded-lg shadow-md font-medium transition-all bg-blue-500 text-white hover:bg-blue-600"
              >
                <span
                  className={`transition-opacity ${isSyncing ? "opacity-50 animate-pulse" : "opacity-100"}`}
                >
                  Sync{isSyncing ? "ing" : ""} Now
                </span>
              </button>
            )}
            <button
              onClick={() => {
                if (google) {
                  googleLogout();
                  clearAuthCookie();
                  setGoogle("");
                } else login();
              }}
              className={`flex items-center gap-3 px-5 py-2 rounded-lg shadow-md font-medium transition-all ${
                google
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
              }`}
            >
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/120px-Google_%22G%22_logo.svg.png"
                alt="Google Logo"
                className="w-5 h-5"
              />
              {google ? "Sign out" : "Sign in with Google to Sync"}
            </button>
          </div>
        </div>
        <div className="mb-4">
          <ActivityForm activities={activities} />
        </div>
        <TagsList activities={activities} />

        {/* Activity List */}
        <div className="flex flex-row gap-4">
          <ActivityList status={Status.Idle} activities={filteredActivities} />
          <ActivityList
            status={Status.Active}
            activities={filteredActivities}
          />
          <ActivityList status={Status.Done} activities={filteredActivities} />
        </div>
      </div>
    </>
  );
}
function ActivityList({
  activities,
  status,
}: {
  status: Status;
  activities: Activity[];
}) {
  const [isFinishedToday, setIsFinishedToday] = useState(false);

  const filteredActivities = useMemo(
    () =>
      activities
        .filter((activity) => getActivityStatus(activity) === status)
        .filter((activity) => {
          if (!isFinishedToday) return true;
          return activity.finishedOn?.includes(
            new Date().toLocaleDateString("en-CA")
          );
        }),
    [activities, isFinishedToday, status]
  );
  return (
    <div className="flex flex-col flex-1 border border-gray-200 rounded-lg">
      <h2 className="text-lg font-semibold px-4 py-2 bg-gray-100 border-b flex justify-between items-center">
        {status === Status.Idle
          ? "To Do"
          : status === Status.Active
            ? "In Progress"
            : "Done"}
        {status === Status.Done && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              className="w-4 h-4 accent-green-500"
              onChange={(e) => setIsFinishedToday(e.target.checked)}
            />
            Finished Today
          </label>
        )}
      </h2>
      <ul className="flex flex-col flex-1">
        {filteredActivities.map((activity) => (
          <ActivityItem key={activity._id} activity={activity} />
        ))}
      </ul>
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const handlers = useSwipeable({
    onSwiped: (eventData) => {
      const today = new Date().toLocaleDateString("en-CA");
      if (eventData.dir === "Right") {
        if (activity.inProgress) {
          mutate({
            finishedOn: [...(activity.finishedOn || []), today],
            inProgress: false,
          });
        } else if (!activity.inProgress) {
          mutate({
            inProgress: true,
          });
        }
      }
      if (eventData.dir === "Left") {
        if (activity.inProgress) {
          mutate({
            inProgress: false,
          });
        } else if (activity.finishedOn?.includes(today)) {
          mutate({
            finishedOn: (activity.finishedOn || []).filter(
              (day) => day !== today
            ),
            inProgress: true,
          });
        }
      }
    },
    trackMouse: true,
  });
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (doc: Partial<Activity>) => putActivity(doc, activity),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects", "activities"],
      });
    },
  });
  const { mutate: deleteActivity } = useDeleteActivity();
  return (
    <li
      {...handlers}
      key={activity._id}
      className="flex items-center p-1 border-b last:border-none hover:bg-gray-100 transition relative"
      onDoubleClick={() => {
        deleteActivity(activity);
      }}
    >
      {/* Action Button */}
      {/* Activity Title */}
      <h3 className="ml-4 py-6 text-lg font-semibold">{activity.title}</h3>
      <span className="absolute right-1 top-1 bg-cyan-500 text-white px-3 py-1 rounded-md text-sm  ">
        {activity.estimation} hours
      </span>
      <span className="absolute right-1 bottom-1 bg-fuchsia-500 text-white px-3 py-1 rounded-md text-sm  ">
        {activity.tag}
      </span>
      {/* Time Spent */}
    </li>
  );
}
export function ActivityForm({ activities }: { activities: Activity[] }) {
  const [tag, setTag] = useState("");
  const [isSuggestionVisible, setIsSuggestionVisible] = useState(false);
  const [repeatsDaily, setRepeatsDaily] = useState(false);
  const [title, setTitle] = useState("");
  const [estimation, setEstimation] = useState(1);

  const suggestions = useMemo(() => {
    if (!tag) return [];

    const uniqueTags = new Set(
      [tag, ...activities.map((a) => a.tag)].filter(Boolean)
    );

    return Array.from(uniqueTags);
  }, [tag, activities]);
  const queryClient = useQueryClient();
  const activityMutation = useMutation({
    mutationFn: putActivity,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects", "activities"],
      });
    },
  });
  const greet = useCallback(
    async function greet() {
      // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
      // setGreetMsg(await invoke("greet", { name }));

      activityMutation.mutate({
        tag,
        title,
        repeatsDaily,
        estimation,
      });
    },
    [activityMutation, tag, title, repeatsDaily, estimation]
  );
  return (
    <form
      className="flex flex-row gap-2 p-2 rounded-xl w-full mx-auto flex-wrap align-center"
      onSubmit={(e) => {
        e.preventDefault();
        greet();
      }}
    >
      {/* Activity Input */}
      <input
        autoComplete="off"
        spellCheck={false}
        id="greet-input"
        onChange={(e) => setTitle(e.currentTarget.value)}
        placeholder="Create new activity..."
        className="p-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 grow"
      />

      {/* Tag Input with Auto-Suggest */}
      <div className="relative z-10">
        <input
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onFocus={() => {
            setIsSuggestionVisible(true);
          }}
          onBlur={() => {
            setTimeout(() => setIsSuggestionVisible(false), 100);
          }}
          placeholder="Add a tag..."
          className="p-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        {suggestions.length > 0 && isSuggestionVisible && (
          <ul className="absolute top-full left-0 w-full bg-white border border-gray-200 rounded-lg mt-1  overflow-hidden">
            {suggestions.map((suggestion) => (
              <li
                key={suggestion}
                onClick={() => {
                  setTag(suggestion);
                }}
                className="p-3 cursor-pointer hover:bg-gray-100 text-gray-700"
              >
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Repeat Daily Toggle */}

      <button
        type="submit"
        className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
      >
        Create
      </button>
      <div className="flex w-full gap-4">
        <label className="flex items-center gap-2 grow">
          Estimation
          <input
            type="range"
            id="temp"
            name="temp"
            list="markers"
            min="0.25" // Set the minimum value
            max="8" // Set the maximum value
            step="0.25" // Define step size to match your `datalist`
            value={estimation}
            onChange={(e) => setEstimation(parseFloat(e.target.value))}
            className="grow"
          />
          <datalist id="markers">
            {[
              0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5,
              7, 7.5, 8,
            ].map((val) => (
              <option key={val} value={val}></option>
            ))}
          </datalist>
          {estimation} hours
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-gray-600">
          <input
            type="checkbox"
            checked={repeatsDaily}
            onChange={() => setRepeatsDaily(!repeatsDaily)}
            className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          Daily
        </label>
      </div>

      {/* Submit Button */}
    </form>
  );
}

const TagsList = ({ activities }: { activities: Activity[] }) => {
  const { tag: current = "" } = useParams();
  const tags = useMemo(() => {
    const uniqueTags = new Set(
      [...activities.map((a) => a.tag)].filter(Boolean)
    );

    return Array.from(uniqueTags);
  }, [activities]);
  return (
    <div className="flex flex-wrap gap-2">
      {[""].concat(tags).map((tag) => (
        <Link
          key={tag}
          to={`/${tag}`}
          className={`px-3 py-1 my-2 rounded-md text-sm transition ${
            tag === current
              ? "bg-red-600 text-blue-100 font-bold"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {tag || (current === "" ? "Showing All" : "Show All")}
        </Link>
      ))}
    </div>
  );
};
export default Project;
function MoodCard({ emoji, score }: { emoji: string; score: number }) {
  const normalizedScore = Math.round(score / 10);

  return (
    <div className="flex items-center gap-2 bg-gradient-to-r from-blue-400 to-purple-400 text-white font-semibold px-4 py-2 rounded-lg shadow-md">
      <span className="text-lg">Today's Mood</span>
      <span className="text-2xl">{emoji}</span>
      <span className="text-lg">
        {String(normalizedScore).padStart(2, "0")}/10
      </span>
    </div>
  );
}
